import { describe, it, expect, afterEach } from 'vitest';
import {
  INSTRUMENTS,
  KOOS_JR,
  getInstrument,
  hasWording,
  registerInstrumentWording,
  clearInstrumentWording,
  withInstrumentText,
  type InstrumentDefinition,
  type InstrumentWording,
} from '../instruments.js';
import { generateConversationalPrompt, mapNaturalLanguageResponse } from '../voice-prom.js';

/** Placeholder wording for tests. Never real instrument text. */
function testWording(instrument: InstrumentDefinition): InstrumentWording {
  return {
    items: Object.fromEntries(
      instrument.items.map((item) => [
        item.id,
        {
          text: `Test question ${item.number}`,
          options: item.options.map((_, i) => `Choice ${i + 1}`),
        },
      ]),
    ),
  };
}

afterEach(() => clearInstrumentWording());

describe('instrument wording', () => {
  it('ships no third-party item or response-option wording', () => {
    for (const instrument of INSTRUMENTS.values()) {
      expect(hasWording(instrument)).toBe(false);
      for (const item of instrument.items) {
        expect(item.text).toBeUndefined();
        for (const option of item.options) expect(option.label).toBeUndefined();
      }
    }
  });

  it('applies supplied wording without changing structure or values', () => {
    const worded = withInstrumentText(KOOS_JR, testWording(KOOS_JR));
    expect(hasWording(worded)).toBe(true);
    expect(worded.items.map((i) => i.id)).toEqual(KOOS_JR.items.map((i) => i.id));
    expect(worded.items[0]!.options.map((o) => o.value)).toEqual(
      KOOS_JR.items[0]!.options.map((o) => o.value),
    );
    expect(hasWording(KOOS_JR)).toBe(false);
  });

  it('refuses incomplete wording', () => {
    const missingItem = testWording(KOOS_JR);
    delete missingItem.items['kj1'];
    expect(() => withInstrumentText(KOOS_JR, missingItem)).toThrow(/kj1/);

    const missingOption = testWording(KOOS_JR);
    missingOption.items['kj2']!.options.pop();
    expect(() => withInstrumentText(KOOS_JR, missingOption)).toThrow(/kj2/);
  });

  it('getInstrument uses registered wording until it is cleared', () => {
    registerInstrumentWording('KOOS_JR', testWording(KOOS_JR));
    expect(hasWording(getInstrument('KOOS_JR'))).toBe(true);
    clearInstrumentWording('KOOS_JR');
    expect(hasWording(getInstrument('KOOS_JR'))).toBe(false);
  });

  it('voice prompts need wording, and work once it is loaded', () => {
    expect(() => generateConversationalPrompt(KOOS_JR.items[0]!, 'KOOS_JR')).toThrow(/no wording loaded/);
    const worded = registerInstrumentWording('KOOS_JR', testWording(KOOS_JR));
    const prompt = generateConversationalPrompt(worded.items[0]!, 'KOOS_JR');
    expect(prompt.exampleMappings).toHaveLength(worded.items[0]!.options.length);
  });

  it('maps spoken answers by keyword and number without wording', () => {
    const mapping = mapNaturalLanguageResponse('it is severe', KOOS_JR.items[3]!);
    expect(mapping.mappedValue).toBe(3);
    expect(mapping.confidence).toBeGreaterThan(0.5);
  });
});
