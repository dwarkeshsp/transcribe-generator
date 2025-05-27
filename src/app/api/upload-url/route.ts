import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const apiKey = process.env.ASSEMBLY_AI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AssemblyAI API key not configured' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      api_key: apiKey, // Client will upload directly to AssemblyAI
    });

  } catch (error) {
    console.error('Upload URL error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}