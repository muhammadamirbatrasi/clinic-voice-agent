require('dotenv').config();
const twilio = require('twilio');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
const axios = require('axios');

console.log('🧪 Testing FREE Services...\n');

// Test 1: Environment Variables
console.log('1️⃣  Testing Environment Variables...');
const requiredVars = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'GROQ_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_KEY'
];

let missingVars = [];
requiredVars.forEach(varName => {
  if (!process.env[varName]) {
    missingVars.push(varName);
  }
});

if (missingVars.length > 0) {
  console.log('❌ Missing environment variables:', missingVars.join(', '));
  console.log('   Please check your .env file\n');
  process.exit(1);
} else {
  console.log('✅ All environment variables set\n');
}

// Test 2: Twilio
async function testTwilio() {
  console.log('2️⃣  Testing Twilio...');
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    console.log('✅ Twilio connected:', account.friendlyName);
    console.log('   Account Status:', account.status);
    console.log('   Phone Number:', process.env.TWILIO_PHONE_NUMBER);
    console.log('   WhatsApp Number:', process.env.TWILIO_WHATSAPP_NUMBER, '\n');
  } catch (error) {
    console.log('❌ Twilio error:', error.message, '\n');
  }
}

// Test 3: Groq API (FREE!)
async function testGroq() {
  console.log('3️⃣  Testing Groq API (FREE AI)...');
  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'user', content: 'Say hello in one word' }
        ],
        max_tokens: 10
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Groq API connected (100% FREE!)');
    console.log('   Test response:', response.data.choices[0].message.content);
    console.log('   Model:', response.data.model, '\n');
  } catch (error) {
    console.log('❌ Groq API error:', error.response?.data?.error?.message || error.message);
    console.log('   Please check your GROQ_API_KEY\n');
  }
}

// Test 4: Supabase
async function testSupabase() {
  console.log('4️⃣  Testing Supabase...');
  try {
    const supabase = createSupabaseClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    
    const { data, error } = await supabase
      .from('appointments')
      .select('count')
      .limit(1);
    
    if (error) {
      if (error.code === '42P01') {
        console.log('⚠️  Supabase connected but table does not exist');
        console.log('   Run: npm run setup\n');
      } else {
        console.log('❌ Supabase error:', error.message, '\n');
      }
    } else {
      console.log('✅ Supabase connected and table exists\n');
    }
  } catch (error) {
    console.log('❌ Supabase error:', error.message, '\n');
  }
}

// Run all tests
async function runAllTests() {
  await testTwilio();
  await testGroq();
  await testSupabase();
  
  console.log('═'.repeat(50));
  console.log('🎉 Testing complete!');
  console.log('═'.repeat(50));
  console.log('\n💰 COST: $0 - All services are 100% FREE!');
  console.log('\nNext steps:');
  console.log('1. If any tests failed, check your .env file');
  console.log('2. Run: npm run setup (to create database tables)');
  console.log('3. Run: npm start (to start the server)');
  console.log('4. Test WhatsApp by messaging your sandbox number\n');
}

runAllTests();
