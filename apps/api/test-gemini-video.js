const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

async function runTest() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not found in .env');
    process.exit(1);
  }

  const genAI = new GoogleGenAI({ apiKey });
  
  // Use the sample video that the fallback used: /images/1790019066-38c49f00.mp4
  // Let's try to find a real video in the workspace.
  const videoPath = path.resolve(__dirname, '../web/public/images/1790019066-38c49f00.mp4');
  if (!fs.existsSync(videoPath)) {
    console.error(`Video file not found: ${videoPath}`);
    process.exit(1);
  }

  const videoBuffer = fs.readFileSync(videoPath);
  
  console.log('Sending video to Gemini for transcription and extraction...');
  
  const prompt = `You are an AI Admissions Intake Agent for Educaro Germany. 
Watch and listen to the applicant's video introduction.
1) Transcribe the spoken audio completely and accurately into a field called "transcript". If there is no spoken audio, return an empty string.
2) Extract the applicant's motivation/reason for moving to Germany.
3) Extract their career and professional goals.
4) Extract their background summary.

If a field genuinely isn't mentioned in the video, return "Not extracted" with 0 confidence, rather than inventing content.

Format the output strictly as JSON with this schema:
{
  "transcript": string,
  "extractedFields": {
    "reasonForGermany": { "value": string, "sourceSnippet": string, "confidence": number },
    "careerGoals": { "value": string, "sourceSnippet": string, "confidence": number },
    "backgroundSummary": { "value": string, "sourceSnippet": string, "confidence": number }
  }
}`;

  try {
    const response = await genAI.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: videoBuffer.toString('base64'),
                mimeType: 'video/mp4'
              }
            },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });

    const text = response.text || '';
    const cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanText);

    console.log('\n--- SUCCESSFUL TEST RUN ---');
    console.log('Transcript:\n', parsed.transcript);
    console.log('\nExtracted Fields:\n', JSON.stringify(parsed.extractedFields, null, 2));
    
  } catch (err) {
    console.error('Test failed with error:', err.message);
  }
}

runTest();
