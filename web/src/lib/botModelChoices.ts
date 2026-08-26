import type { ModelOptions } from './hermesTypes';

export interface BotModelChoice {
  value: string;
  label: string;
}

export function botModelChoices(options: ModelOptions | null | undefined): BotModelChoice[] {
  return [
    { value: '', label: 'inherit' },
    ...(options?.providers ?? [])
      .filter((provider) => provider.authenticated !== false)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          value: `${provider.slug}|${model}`,
          label: `${model} · ${provider.name}`,
        })),
      ),
  ];
}
