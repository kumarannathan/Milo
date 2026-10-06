import { salesHandlers, salesPurposes } from './sales.js';
import { marketsHandlers, marketsPurposes } from './markets.js';
import { demoDelay, fake, sleep, tokens } from './util.js';

const PURPOSES = { ...salesPurposes, ...marketsPurposes };

// Answers llm.complete without a model: each `purpose` has a generator that builds a
// realistic response from `input`. Unknown purposes get a short generic reply.
async function complete(args, { io }) {
  const generator = PURPOSES[args.purpose];
  return io.track('demo.messages', async () => {
    await sleep(demoDelay(600 + Math.random() * 1400));
    const data = generator ? generator(args.input ?? {}, args) : null;
    const text = data ? JSON.stringify(data) : 'Done.';
    return {
      text,
      data: args.json ? data : undefined,
      tokensIn: tokens(args.system) + tokens(args.prompt) + 400,
      tokensOut: tokens(text),
      model: 'sample-model',
    };
  });
}

export default {
  id: 'demo',
  name: 'Sample data',
  category: 'Built in',
  description: 'Fake companies, people, markets and model output so you can try Milo without any keys.',
  playbooks: ['sales', 'markets'],
  fields: [],
  models: ['sample-model'],
  defaultModel: 'sample-model',
  pricing: () => ({ in: 3, out: 15 }),
  handlers: {
    'llm.complete': complete,
    'notify.post': (args, { io }) => fake(io, 'demo.notify', () => ({ ok: true }), { min: 80, max: 200 }),
    ...salesHandlers,
    ...marketsHandlers,
    // Research is shared: market questions get market news, everything else company news.
    'web.search': (args, x) => (args.topic === 'market' ? marketsHandlers : salesHandlers)['web.search']?.(args, x) ?? { results: [] },
    'signals.news': (args, x) => (args.topic === 'market' ? marketsHandlers : salesHandlers)['signals.news']?.(args, x) ?? { items: [] },
  },
  async test() {
    return { account: 'built in' };
  },
};
