// Plain-language explanations for the concepts the post-game flow surfaces,
// shown via the InfoTip "?" affordances. Single source of truth so the wording
// stays consistent wherever a concept is explained.
//
// Consumer-first: no attestation / chain / People Chain jargon — just what it
// means for the player. Rewards are real and spendable, so the copy can be
// concrete. No em-dashes (house style).

export interface Concept {
  title: string
  body: string
}

export const CONCEPTS = {
  membership: {
    title: 'Membership',
    body: "Becoming a member means you've shown you're a real, unique player. Members are automatically entered in the weekly CASH prize draw, and can claim a custom username. It's a one-time step."
  },
  prizeDraw: {
    title: 'Weekly prize draw',
    body: "Every week, members are automatically entered into a draw for CASH. If your ticket's drawn, you win. There's nothing to enter."
  },
  // (The CASH concept is now conveyed by the coin-deposit animation on the
  // win result screen rather than a tooltip, so no `cash` entry here.)
  username: {
    title: 'Your username',
    body: "As a member you can drop the numbers from your temporary handle (byteboro.42 becomes byteboro), or pick a completely different name if you'd like. Either way, claim it in the Prizes chat."
  }
} as const satisfies Record<string, Concept>
