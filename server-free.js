require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const twilio = require('twilio');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Initialize
const app = express();
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const supabase = createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Store active conversations
const activeConversations = new Map();

// Clinic knowledge base
const clinicContext = `You are a helpful assistant for ${process.env.CLINIC_NAME}, a ${process.env.CLINIC_TYPE} clinic.

CLINIC INFO:
- Name: ${process.env.CLINIC_NAME}
- Address: ${process.env.CLINIC_ADDRESS}
- Phone: ${process.env.CLINIC_PHONE}
- Hours: ${process.env.CLINIC_HOURS}

SERVICES (Dentist):
- General Checkup: 30 min, PKR 2000
- Teeth Whitening: 60 min, PKR 15000
- Cavity Filling: 45 min, PKR 3500
- Root Canal: 90 min, PKR 12000
- Tooth Extraction: 30 min, PKR 2500

YOUR JOB:
1. Greet warmly
2. Ask what service they need
3. Suggest available times
4. Collect: Name, Phone, Preferred Date/Time
5. Confirm appointment
6. Keep responses SHORT (1-2 sentences)
7. Be conversational and friendly

IMPORTANT: Be natural and helpful. Don't use bullet points in conversation.`;

// Available slots (simplified)
const availableSlots = {
  'Monday': ['9:00 AM', '10:00 AM', '2:00 PM', '3:00 PM', '4:00 PM'],
  'Tuesday': ['9:00 AM', '10:00 AM', '2:00 PM', '3:00 PM', '4:00 PM'],
  'Wednesday': ['9:00 AM', '10:00 AM', '2:00 PM', '3:00 PM', '4:00 PM'],
  'Thursday': ['9:00 AM', '10:00 AM', '2:00 PM', '3:00 PM', '4:00 PM'],
  'Friday': ['9:00 AM', '10:00 AM', '2:00 PM', '3:00 PM', '4:00 PM'],
  'Saturday': ['9:00 AM', '10:00 AM', '2:00 PM', '3:00 PM']
};

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'Clinic Voice Agent (FREE Version)',
    clinic: process.env.CLINIC_NAME,
    features: {
      whatsapp: 'enabled',
      voice: 'enabled (text-based)',
      ai: 'Groq (Free)',
      database: 'Supabase (Free)'
    },
    endpoints: {
      voice: '/voice',
      whatsapp: '/whatsapp',
      sms: '/sms',
      status: '/status'
    }
  });
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'healthy',
    activeConversations: activeConversations.size,
    uptime: process.uptime(),
    version: 'free'
  });
});

// Voice endpoint (Twilio Voice)
app.post('/voice', async (req, res) => {
  console.log('📞 Incoming call from:', req.body.From);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Greet the caller
  twiml.say({
    voice: 'alice',
    language: 'en-US'
  }, `Hello! Thank you for calling ${process.env.CLINIC_NAME}. To book an appointment, please send us a WhatsApp message or text to this number. Thank you!`);
  
  // Optionally redirect to SMS for appointment booking
  twiml.pause({ length: 1 });
  twiml.say('You can also press any key to receive a text message with our WhatsApp number.');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// SMS endpoint (for text-based appointment booking)
app.post('/sms', async (req, res) => {
  console.log('💬 SMS from:', req.body.From);
  const incomingMsg = req.body.Body;
  const fromNumber = req.body.From;
  
  try {
    // Get or create conversation
    let conversation = activeConversations.get(fromNumber) || {
      messages: [],
      appointmentData: {}
    };
    
    // Add user message
    conversation.messages.push({
      role: 'user',
      content: incomingMsg
    });
    
    // Get AI response using Groq
    const aiResponse = await getGroqResponse(conversation);
    
    // Add AI response
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse
    });
    
    // Save conversation
    activeConversations.set(fromNumber, conversation);
    
    // Check if appointment complete
    if (aiResponse.toLowerCase().includes('confirmed') || 
        aiResponse.toLowerCase().includes('booked')) {
      await saveAppointment(fromNumber, conversation);
    }
    
    // Send SMS response
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(aiResponse);
    
    res.type('text/xml');
    res.send(twiml.toString());
    
  } catch (error) {
    console.error('SMS error:', error);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Sorry, I encountered an error. Please try again or call us directly.');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// WhatsApp endpoint
app.post('/whatsapp', async (req, res) => {
  console.log('💬 WhatsApp message from:', req.body.From);
  
  const incomingMsg = req.body.Body;
  const fromNumber = req.body.From;
  
  try {
    // Get or create conversation
    let conversation = activeConversations.get(fromNumber) || {
      messages: [],
      appointmentData: {}
    };
    
    // Add user message
    conversation.messages.push({
      role: 'user',
      content: incomingMsg
    });
    
    // Get AI response using Groq (FREE!)
    const aiResponse = await getGroqResponse(conversation);
    
    // Add AI response
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse
    });
    
    // Save conversation
    activeConversations.set(fromNumber, conversation);
    
    // Check if appointment is complete
    if (aiResponse.toLowerCase().includes('confirmed') || 
        aiResponse.toLowerCase().includes('booked')) {
      await saveAppointment(fromNumber, conversation);
    }
    
    // Send WhatsApp response
    await twilioClient.messages.create({
      body: aiResponse,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: fromNumber
    });
    
    res.sendStatus(200);
    
  } catch (error) {
    console.error('WhatsApp error:', error);
    
    await twilioClient.messages.create({
      body: 'Sorry, I encountered an error. Please try again or call us directly.',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: fromNumber
    });
    
    res.sendStatus(500);
  }
});

// Get AI response from Groq (100% FREE!)
async function getGroqResponse(conversation) {
  try {
    const messages = [
      {
        role: 'system',
        content: clinicContext
      },
      ...conversation.messages
    ];
    
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile', // Free model
        messages: messages,
        max_tokens: 150,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.choices[0].message.content;
    
  } catch (error) {
    console.error('Groq API error:', error.response?.data || error.message);
    return "I'm having trouble processing that right now. Could you please try again?";
  }
}

// Save appointment to Supabase
async function saveAppointment(phoneNumber, conversation) {
  try {
    const appointmentData = extractAppointmentData(conversation);
    
    const { data, error } = await supabase
      .from('appointments')
      .insert([
        {
          patient_name: appointmentData.name || 'Unknown',
          patient_phone: phoneNumber,
          service_type: appointmentData.service || 'General Consultation',
          appointment_date: appointmentData.date || new Date().toISOString(),
          appointment_time: appointmentData.time || '10:00 AM',
          status: 'confirmed',
          created_at: new Date().toISOString()
        }
      ]);
    
    if (error) {
      console.error('Database error:', error);
    } else {
      console.log('✅ Appointment saved');
    }
    
  } catch (error) {
    console.error('Save appointment error:', error);
  }
}

// Extract appointment data (simple keyword extraction)
function extractAppointmentData(conversation) {
  const data = {
    name: null,
    service: null,
    date: null,
    time: null
  };
  
  const fullText = conversation.messages
    .map(m => m.content)
    .join(' ')
    .toLowerCase();
  
  // Extract service
  const services = ['cleaning', 'whitening', 'filling', 'root canal', 'extraction', 'checkup'];
  for (const service of services) {
    if (fullText.includes(service)) {
      data.service = service;
      break;
    }
  }
  
  // Extract time
  const timeMatch = fullText.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
  if (timeMatch) {
    data.time = timeMatch[0];
  }
  
  return data;
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║   🏥 Clinic Voice Agent (FREE Version)    ║
╠════════════════════════════════════════════╣
║  Port: ${PORT}                              
║  Clinic: ${process.env.CLINIC_NAME}       
║  Type: ${process.env.CLINIC_TYPE}          
╠════════════════════════════════════════════╣
║  🆓 FREE SERVICES USED:                    ║
║  ✅ Twilio (Trial)                         ║
║  ✅ Groq AI (Free Unlimited)               ║
║  ✅ Supabase (Free Tier)                   ║
╠════════════════════════════════════════════╣
║  Endpoints:                                ║
║  📞 Voice: POST /voice                     ║
║  💬 WhatsApp: POST /whatsapp               ║
║  📱 SMS: POST /sms                         ║
║  📊 Status: GET /status                    ║
╚════════════════════════════════════════════╝
  `);
});
