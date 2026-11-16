import Anthropic from '@anthropic-ai/sdk';

export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';

export const anthropicProvider = { provide: ANTHROPIC_CLIENT, useFactory: () => new Anthropic() };
