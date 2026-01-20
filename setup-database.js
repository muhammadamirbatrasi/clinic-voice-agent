require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function setupDatabase() {
  console.log('🗄️  Setting up Supabase database...\n');

  try {
    // Note: In Supabase, you need to run this SQL in the SQL Editor
    // This script just shows you what to run
    
    const sqlScript = `
-- Create appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  patient_name TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  service_type TEXT NOT NULL,
  appointment_date TIMESTAMP NOT NULL,
  appointment_time TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(patient_phone);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- Create doctors table (optional)
CREATE TABLE IF NOT EXISTS doctors (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  schedule JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create services table (optional)
CREATE TABLE IF NOT EXISTS services (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price_pkr INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert sample services for dentist
INSERT INTO services (name, duration_minutes, price_pkr, description) VALUES
  ('General Checkup & Cleaning', 30, 2000, 'Complete dental examination and cleaning'),
  ('Teeth Whitening', 60, 15000, 'Professional teeth whitening treatment'),
  ('Cavity Filling', 45, 3500, 'Tooth cavity filling'),
  ('Root Canal', 90, 12000, 'Root canal treatment'),
  ('Tooth Extraction', 30, 2500, 'Simple tooth extraction'),
  ('Dental Implant', 120, 50000, 'Dental implant procedure')
ON CONFLICT DO NOTHING;

-- Enable Row Level Security (optional but recommended)
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (for demo - adjust for production)
CREATE POLICY "Allow all operations" ON appointments FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON doctors FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON services FOR ALL USING (true);
`;

    console.log('📋 Copy and paste this SQL into your Supabase SQL Editor:\n');
    console.log('=' .repeat(70));
    console.log(sqlScript);
    console.log('=' .repeat(70));
    console.log('\n📍 Steps:');
    console.log('1. Go to https://app.supabase.com');
    console.log('2. Select your project');
    console.log('3. Click "SQL Editor" in the left sidebar');
    console.log('4. Click "New Query"');
    console.log('5. Paste the SQL above');
    console.log('6. Click "Run" or press Ctrl+Enter\n');

    // Test connection
    console.log('🔌 Testing Supabase connection...');
    const { data, error } = await supabase
      .from('appointments')
      .select('count')
      .limit(1);

    if (error && error.code === '42P01') {
      console.log('⚠️  Table does not exist yet. Run the SQL above first.');
    } else if (error) {
      console.log('❌ Connection error:', error.message);
    } else {
      console.log('✅ Connection successful!');
      
      // Insert a test appointment
      console.log('\n📝 Creating test appointment...');
      const { data: testData, error: testError } = await supabase
        .from('appointments')
        .insert([
          {
            patient_name: 'Test Patient',
            patient_phone: '+92-300-0000000',
            service_type: 'General Checkup',
            appointment_date: new Date().toISOString(),
            appointment_time: '10:00 AM',
            status: 'confirmed',
            notes: 'Test appointment created by setup script'
          }
        ])
        .select();

      if (testError) {
        console.log('❌ Error creating test appointment:', testError.message);
      } else {
        console.log('✅ Test appointment created:', testData);
        console.log('\n🎉 Database setup complete!\n');
      }
    }

  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
}

setupDatabase();
