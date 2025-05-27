'use client';

import { useState } from 'react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [geminiTranscript, setGeminiTranscript] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleFileUpload = (uploadedFile: File) => {
    setFile(uploadedFile);
    setError('');
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileUpload(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const processFile = async () => {
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to transcribe audio');
      }

      const result = await response.json();
      setTranscript(result.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setUploading(false);
    }
  };

  const downloadMarkdown = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 text-center mb-8">
          AI Transcript Generator
        </h1>

        {/* File Upload Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Upload Audio/Video File</h2>
          
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors"
          >
            {file ? (
              <div className="text-green-600">
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <div>
                <p className="text-gray-600 mb-2">
                  Drag and drop your audio/video file here, or
                </p>
                <input
                  type="file"
                  accept="audio/*,video/*"
                  onChange={(e) => {
                    const selectedFile = e.target.files?.[0];
                    if (selectedFile) handleFileUpload(selectedFile);
                  }}
                  className="hidden"
                  id="file-input"
                />
                <label
                  htmlFor="file-input"
                  className="bg-blue-500 text-white px-4 py-2 rounded cursor-pointer hover:bg-blue-600 transition-colors"
                >
                  Choose File
                </label>
              </div>
            )}
          </div>

          {file && (
            <button
              onClick={processFile}
              disabled={uploading}
              className="w-full mt-4 bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600 disabled:bg-gray-400 transition-colors"
            >
              {uploading ? 'Processing...' : 'Generate Transcript'}
            </button>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}
        </div>

        {/* Results Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ElevenLabs Transcript */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">ElevenLabs Transcript</h2>
              {transcript && (
                <button
                  onClick={() => downloadMarkdown(transcript, 'elevenlabs-transcript.md')}
                  className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 transition-colors"
                >
                  Download
                </button>
              )}
            </div>
            
            {transcript ? (
              <div className="bg-gray-50 p-4 rounded border max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm">{transcript}</pre>
              </div>
            ) : (
              <div className="bg-gray-50 p-4 rounded border text-gray-500 text-center">
                Upload and process a file to see the transcript
              </div>
            )}
          </div>

          {/* Gemini Enhanced Transcript (Future Feature) */}
          <div className="bg-white rounded-lg shadow-md p-6 opacity-50">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Gemini Enhanced Transcript</h2>
              <button
                disabled
                className="bg-gray-400 text-white px-3 py-1 rounded text-sm cursor-not-allowed"
              >
                Download
              </button>
            </div>
            
            <div className="bg-gray-50 p-4 rounded border text-gray-500 text-center">
              Coming soon - AI-enhanced transcript with error correction
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}