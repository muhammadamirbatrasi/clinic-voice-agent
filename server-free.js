require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const twilio = require('twilio');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
const axios = require('axios');
const WebSocket = require('ws');
const { createClient: createDeepgramClient } = require('@deepgram/sdk');

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
const availableSlots = [
  '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'
];

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'Clinic Voice Agent + AI Calling',
    clinic: process.env.CLINIC_NAME || 'Dental Clinic',
    features: {
      voice: 'enabled (AI-powered)',
      whatsapp: 'enabled',
      sms: 'enabled',
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
    version: 'voice-enabled'
  });
});

// Voice endpoint (Twilio Voice) - Full AI Voice
app.post('/voice', async (req, res) => {
  console.log('📞 Incoming voice call from:', req.body.From);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Initial AI greeting
  twiml.say({
    voice: 'Polly.Joanna',
    language: 'en-US'
  }, `Hello! Welcome to ${process.env.CLINIC_NAME}. I'm your AI assistant. How can I help you today?`);
  
  twiml.pause({ length: 1 });
  
  // Start WebSocket stream for real-time AI conversation
  const connect = twiml.connect();
  connect.stream({
    url: `wss://${req.headers.host}/voice-stream`
  });
  
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
    
    // Update conversation
    activeConversations.set(fromNumber, conversation);
    
    // Check if appointment is complete
    if (aiResponse.toLowerCase().includes('confirmed') || aiResponse.toLowerCase().includes('booked')) {
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
    twiml.message('Sorry, I encountered an error. Please try again.');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// WhatsApp endpoint
app.post('/whatsapp', async (req, res) => {
  console.log('💬 WhatsApp from:', req.body.From);
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
    
    // Update conversation
    activeConversations.set(fromNumber, conversation);
    
    // Check if appointment is complete
    if (aiResponse.toLowerCase().includes('confirmed') || aiResponse.toLowerCase().includes('booked')) {
      await saveAppointment(fromNumber, conversation);
    }
    
    // Send WhatsApp response
    await twilioClient.messages.create({
      body: aiResponse,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: fromNumber
    });
    
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    
  } catch (error) {
    console.error('WhatsApp error:', error);
    res.sendStatus(500);
  }
});

// Get AI response using Groq
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
        model: 'llama-3.3-70b-versatile',
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
    return "I'm having trouble processing that. Could you please try again?";
  }
}

// Save appointment to Supabase
async function saveAppointment(phoneNumber, conversation) {
  const appointmentData = extractAppointmentData(conversation.messages);
  
  try {
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
          notes: 'Booked via AI assistant',
          created_at: new Date().toISOString()
        }
      ]);
    
    if (error) {
      console.error('Database error:', error);
    } else {
      console.log('✅ Appointment saved to database');
    }
  } catch (error) {
    console.error('Save error:', error);
  }
}

// Extract appointment data from conversation
function extractAppointmentData(messages) {
  const fullText = messages
    .map(m => m.content)
    .join(' ')
    .toLowerCase();
  
  const data = {
    service: null,
    date: null,
    time: null,
    name: null
  };
  
  // Extract service
  const services = ['checkup', 'whitening', 'filling', 'root canal', 'extraction'];
  for (const service of services) {
    if (fullText.includes(service)) {
      data.service = service;
      break;
    }
  }
  
  // Extract date
  if (fullText.includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    data.date = tomorrow.toISOString().split('T')[0];
  } else if (fullText.includes('today')) {
    data.date = new Date().toISOString().split('T')[0];
  }
  
  // Extract time
  const timeMatch = fullText.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
  if (timeMatch) {
    data.time = timeMatch[0];
  }
  
  // Extract name
  const namePatterns = [
    /my name is (\w+\s*\w*)/i,
    /i am (\w+\s*\w*)/i,
    /this is (\w+\s*\w*)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = fullText.match(pattern);
    if (match) {
      data.name = match[1].trim();
      break;
    }
  }
  
  return data;
}

// Text-to-Speech using ElevenLabs
async function textToSpeech(text) {
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'}`,
      {
        text: text,
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      },
      {
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error('TTS error:', error.message);
    return null;
  }
}

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log('==============================================');
  console.log('   Clinic Voice Agent + AI Calling');
  console.log('==============================================');
  console.log('  Port:', PORT);
  console.log('  Clinic:', process.env.CLINIC_NAME || 'Dental Clinic');
  console.log('  Type:', process.env.CLINIC_TYPE || 'dentist');
  console.log('==============================================');
  console.log('  VOICE AI CALLING ENABLED:');
  console.log('  - Real-time speech recognition');
  console.log('  - AI conversation (Groq)');
  console.log('  - Natural voice synthesis');
  console.log('==============================================');
  console.log('  FREE SERVICES USED:');
  console.log('  - Twilio (Trial)');
  console.log('  - Deepgram STT (Free 45K min)');
  console.log('  - Groq AI (Free Unlimited)');
  console.log('  - ElevenLabs TTS (Free 10K chars)');
  console.log('  - Supabase (Free Tier)');
  console.log('==============================================');
  console.log('  Endpoints:');
  console.log('  - Voice: POST /voice');
  console.log('  - Stream: WS /voice-stream');
  console.log('  - WhatsApp: POST /whatsapp');
  console.log('  - SMS: POST /sms');
  console.log('  - Status: GET /status');
  console.log('==============================================');
});

// WebSocket Server for Voice Streaming
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  
  if (pathname === '/voice-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (ws) => {
  console.log('Voice stream connected');
  
  let callSid = null;
  let streamSid = null;
  let callerNumber = null;
  let deepgramConnection = null;
  
  // Conversation for this call
  let conversation = {
    messages: [],
    lastTranscript: ''
  };
  
  try {
    // Connect to Deepgram
    const deepgram = createDeepgramClient(process.env.DEEPGRAM_API_KEY);
    
    deepgramConnection = deepgram.listen.live({
      model: 'nova-2',
      language: 'en',
      smart_format: true,
      interim_results: false,
      utterance_end_ms: 1000
    });
    
    console.log('Connected to Deepgram');
    
    // Handle transcription
    deepgramConnection.on('transcript', async (data) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      
      if (transcript && transcript.trim().length > 0 && transcript !== conversation.lastTranscript) {
        conversation.lastTranscript = transcript;
        console.log('Patient said:', transcript);
        
        // Add to conversation
        conversation.messages.push({
          role: 'user',
          content: transcript
        });
        
        try {
          // Get AI response
          const messages = [
            { role: 'system', content: clinicContext },
            ...conversation.messages
          ];
          
          const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model: 'llama-3.3-70b-versatile',
              messages: messages,
              max_tokens: 100,
              temperature: 0.7
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          const aiResponse = response.data.choices[0].message.content;
          console.log('AI responds:', aiResponse);
          
          // Add to conversation
          conversation.messages.push({
            role: 'assistant',
            content: aiResponse
          });
          
          // Convert to speech
          const audioData = await textToSpeech(aiResponse);
          
          if (audioData && streamSid) {
            sendAudioToTwilio(ws, streamSid, audioData);
          }
          
          // Check if appointment complete
          if (aiResponse.toLowerCase().includes('confirmed')) {
            await saveAppointment(callerNumber, conversation);
          }
          
        } catch (error) {
          console.error('Error processing:', error.message);
        }
      }
    });
    
  } catch (error) {
    console.error('Deepgram error:', error.message);
  }
  
  // Handle Twilio messages
  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      
      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          
          try {
            const call = await twilioClient.calls(callSid).fetch();
            callerNumber = call.from;
            console.log('Call started:', callSid);
          } catch (error) {
            console.error('Error:', error.message);
          }
          break;
          
        case 'media':
          if (deepgramConnection && msg.media.payload) {
            const audio = Buffer.from(msg.media.payload, 'base64');
            deepgramConnection.send(audio);
          }
          break;
          
        case 'stop':
          console.log('Call ended');
          if (deepgramConnection) {
            deepgramConnection.finish();
          }
          break;
      }
    } catch (error) {
      console.error('WebSocket error:', error.message);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket closed');
    if (deepgramConnection) {
      deepgramConnection.finish();
    }
  });
});

// Send audio back to Twilio
function sendAudioToTwilio(ws, streamSid, audioBuffer) {
  try {
    const base64Audio = audioBuffer.toString('base64');
    
    // Send in chunks
    const chunkSize = 8000;
    for (let i = 0; i < base64Audio.length; i += chunkSize) {
      const chunk = base64Audio.slice(i, i + chunkSize);
      
      ws.send(JSON.stringify({
        event: 'media',
        streamSid: streamSid,
        media: { payload: chunk }
      }));
    }
  } catch (error) {
    console.error('Send audio error:', error.message);
  }
}