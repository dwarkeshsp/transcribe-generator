import { NextRequest, NextResponse } from 'next/server';

interface WordSegment {
  text: string;
  start: number;
  end: number;
  type: 'word' | 'spacing' | 'audio_event';
  speaker_id: string;
}

interface TranscriptionResponse {
  language_code: string;
  language_probability: number;
  text: string;
  words: WordSegment[];
}

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function filterCrosstalk(words: WordSegment[]): WordSegment[] {
  const crosstalkPhrases = new Set([
    'mm', 'mm-hmm', 'mmm', 'mm.', 'mm-hmm.',
    'yeah', 'yes', 'yep', 'yup',
    'uh', 'um', 'umm', 'uh-huh',
    'hmm', 'hm', 'hmm.',
    'oh', 'ah', 'ahh',
    'okay', 'ok', 'right',
    'sure', 'exactly', 'absolutely',
    'mhm', 'mhmm', 'aha'
  ]);

  return words.filter(word => {
    if (word.type !== 'word') return true;
    
    const cleanText = word.text.toLowerCase().replace(/[.,!?]/g, '').trim();
    
    // Filter out crosstalk phrases
    if (crosstalkPhrases.has(cleanText)) return false;
    
    // Filter out very short utterances (under 1 second)
    const duration = word.end - word.start;
    if (duration < 1 && cleanText.length <= 3) return false;
    
    // Filter out single characters
    if (cleanText.length <= 1) return false;
    
    return true;
  });
}

function formatTranscriptToMarkdown(words: WordSegment[]): string {
  const filteredWords = filterCrosstalk(words);
  
  if (filteredWords.length === 0) {
    return 'No valid transcript content found after filtering.';
  }

  let markdown = '';
  let currentSpeaker = '';
  let currentSpeakerNumber = 0;
  const speakerMap = new Map<string, number>();
  let utteranceBuffer: string[] = [];
  let lastTimestamp = 0;

  filteredWords.forEach((word, index) => {
    if (word.type === 'word') {
      // Check if speaker has changed
      if (word.speaker_id !== currentSpeaker) {
        // Flush any previous utterance
        if (utteranceBuffer.length > 0 && currentSpeaker) {
          markdown += utteranceBuffer.join('') + '\n\n';
          utteranceBuffer = [];
        }

        // Handle new speaker
        currentSpeaker = word.speaker_id;
        if (!speakerMap.has(currentSpeaker)) {
          currentSpeakerNumber++;
          speakerMap.set(currentSpeaker, currentSpeakerNumber);
        }

        const speakerNum = speakerMap.get(currentSpeaker);
        const timestamp = formatTimestamp(word.start);
        markdown += `Speaker ${speakerNum} *${timestamp}*\n\n`;
        lastTimestamp = word.start;
      }

      utteranceBuffer.push(word.text);
    } else if (word.type === 'spacing') {
      utteranceBuffer.push(word.text);
    }
  });

  // Flush final utterance
  if (utteranceBuffer.length > 0) {
    markdown += utteranceBuffer.join('') + '\n\n';
  }

  return markdown.trim();
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ELEVEN_LABS_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Check file size (1GB limit from ElevenLabs docs)
    if (file.size > 1024 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size exceeds 1GB limit' },
        { status: 400 }
      );
    }

    // Prepare form data for ElevenLabs API
    const elevenLabsFormData = new FormData();
    elevenLabsFormData.append('file', file);
    elevenLabsFormData.append('model_id', 'scribe_v1');

    // Call ElevenLabs Speech-to-Text API
    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: elevenLabsFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API error:', errorText);
      return NextResponse.json(
        { error: `ElevenLabs API error: ${response.status}` },
        { status: response.status }
      );
    }

    const transcriptionData: TranscriptionResponse = await response.json();
    
    // Format the response to markdown
    const markdownTranscript = formatTranscriptToMarkdown(transcriptionData.words);

    return NextResponse.json({
      transcript: markdownTranscript,
      language: transcriptionData.language_code,
      confidence: transcriptionData.language_probability,
    });

  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: 'Internal server error during transcription' },
      { status: 500 }
    );
  }
}