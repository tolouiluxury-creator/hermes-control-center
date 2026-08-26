import { describe, expect, it } from 'vitest';
import { botModelChoices } from './botModelChoices';

describe('botModelChoices', () => {
  it('keeps an inherit option and exposes only authenticated provider models', () => {
    expect(
      botModelChoices({
        currentModel: 'gpt-4o',
        currentProvider: 'openai',
        providers: [
          {
            slug: 'openai',
            name: 'OpenAI',
            authenticated: true,
            models: ['gpt-5'],
            isCurrent: true,
            authType: 'api_key',
            source: null,
            totalModels: 1,
            warning: null,
            userDefined: false,
          },
          {
            slug: 'locked',
            name: 'Locked',
            authenticated: false,
            models: ['secret-model'],
            isCurrent: false,
            authType: 'api_key',
            source: null,
            totalModels: 1,
            warning: null,
            userDefined: false,
          },
        ],
      }),
    ).toEqual([
      { value: '', label: 'inherit' },
      { value: 'openai|gpt-5', label: 'gpt-5 · OpenAI' },
    ]);
  });
});
