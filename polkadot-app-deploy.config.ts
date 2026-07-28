// SPDX-License-Identifier: MIT
//
// Product manifest for `@polkadot-community-foundation/polkadot-app-deploy`
// (the Bulletin app-deploy CLI). The tool auto-discovers this file by name
// (`polkadot-app-deploy.config.{ts,js,mjs}`, walking up from the build dir) and
// reads the default export to publish the product manifest (displayName,
// description, icon) alongside the content upload. A file named anything else is
// silently ignored — manifest publish skipped, no error.
//
// `defineConfig` is vendored as an identity function rather than imported from
// the deploy CLI: the tool is a global/npx CLI, not a package.json dependency,
// so importing from it would make config resolution fragile.
const defineConfig = <T>(config: T): T => config;

declare const process: { env?: Record<string, string | undefined> };

// APP_DOTNS_DOMAIN lets CI/preview deploys override the bare label; defaults to
// the production label. MUST match the domain the CLI is invoked with.
const domain = process.env?.APP_DOTNS_DOMAIN ?? "game-results-webview";
const label = domain.toLowerCase().replace(/\.dot$/, "");

export default defineConfig({
  domain: `${label}.dot`,
  displayName: "Game Results",
  description:
    "A post-game celebration WebView that reveals a player's collectibles, membership, prize-draw result, and new username as one animated sequence.",
  // PLACEHOLDER ICON: the repo ships only in-scene .webp art (cards, badges,
  // chest sprite sheet) and has no square app icon of its own, so this is the
  // shared devnet build icon — white tile, black Polkadot mark, DEV label — from
  // the app icon design language. It unblocks manifest publish, which fails
  // loudly without a readable file here. Replace with bespoke artwork when there
  // is any; a re-encoded webp from public/assets is still a candidate. If this
  // product is ever published to mainnet, swap in the unlabelled production
  // variant — the DEV label would otherwise misreport the network.
  icon: { path: "./assets/icon.png", format: "png" },
  executables: [
    {
      kind: "app",
      path: "./dist",
      appVersion: [0, 1, 0],
    },
  ],
});
