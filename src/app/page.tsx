'use client';

import { useState } from 'react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
    }
  };

  const processFile = async () => {
    if (!file) return;

    setProcessing(true);
    setError('');
    setTranscript('');

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
      setProcessing(false);
    }
  };

  const downloadMarkdown = () => {
    if (!transcript) return;
    
    const blob = new Blob([transcript], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSelectAll = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      const textarea = e.currentTarget;
      textarea.select();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto max-w-4xl px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Transcript Generator
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Upload audio or video files to generate speaker-labeled transcripts
          </p>
        </div>

        {/* Upload Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 mb-8">
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Select audio or video file
            </label>
            <input
              type="file"
              accept="audio/*,video/*"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 dark:text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-medium
                file:bg-blue-50 file:text-blue-700
                dark:file:bg-blue-900/20 dark:file:text-blue-400
                hover:file:bg-blue-100 dark:hover:file:bg-blue-900/30
                file:cursor-pointer cursor-pointer"
            />
            {file && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
          </div>

          <button
            onClick={processFile}
            disabled={!file || processing}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 
              text-white font-medium py-3 px-6 rounded-md transition-colors
              disabled:cursor-not-allowed"
          >
            {processing ? 'Processing...' : 'Generate Transcript'}
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 
            text-red-800 dark:text-red-400 px-4 py-3 rounded-md mb-8">
            <p className="font-medium">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {/* Results Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Transcript
            </h2>
            {transcript && (
              <button
                onClick={downloadMarkdown}
                className="bg-green-600 hover:bg-green-700 text-white font-medium 
                  py-2 px-4 rounded-md transition-colors text-sm"
              >
                Download
              </button>
            )}
          </div>
          
          <textarea
            value={transcript}
            readOnly
            onKeyDown={handleSelectAll}
            placeholder={processing ? 'Processing transcript...' : 'Transcript will appear here after processing'}
            className="w-full h-96 p-4 border border-gray-300 dark:border-gray-600 
              rounded-md resize-y font-mono text-sm
              bg-white dark:bg-gray-900
              text-gray-900 dark:text-gray-100
              placeholder-gray-500 dark:placeholder-gray-400
              focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              dark:focus:ring-blue-400 dark:focus:border-blue-400"
          />
        </div>
      </div>
    </div>
  );
}