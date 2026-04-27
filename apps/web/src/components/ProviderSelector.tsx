'use client';

import type { TranscriptionProvider } from '@/types/jobs';
import { PROVIDER_LABEL, PROVIDER_NOTES } from '@/lib/providerDisplay';

interface Props {
  value: TranscriptionProvider;
  onChange: (next: TranscriptionProvider) => void;
  disabled?: boolean;
}

const ORDER: TranscriptionProvider[] = ['deepgram', 'openai', 'assemblyai'];

export function ProviderSelector({ value, onChange, disabled }: Props) {
  return (
    <fieldset className="rounded-lg border border-slate-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-slate-800">
        Transcription engine
      </legend>
      <div
        role="radiogroup"
        aria-label="Choose the transcription provider"
        className="grid gap-2 sm:grid-cols-3"
      >
        {ORDER.map((p) => {
          const selected = value === p;
          return (
            <label
              key={p}
              className={`flex cursor-pointer flex-col rounded-md border px-3 py-2 text-sm transition-colors ${
                selected
                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                  : 'border-slate-200 hover:border-slate-300'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="provider"
                value={p}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(p)}
                className="sr-only"
              />
              <span className="font-medium text-slate-900">{PROVIDER_LABEL[p]}</span>
              <span className="mt-0.5 text-xs text-slate-500">{PROVIDER_NOTES[p]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
