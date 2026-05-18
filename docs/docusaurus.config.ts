import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: "Kite Agentic Pay",
  tagline: "Autonomous payment infrastructure for AI agents",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  url: "https://kite-agentic-pay.docs.example.com",
  baseUrl: "/",

  organizationName: "kite-agentic-pay",
  projectName: "kite-agentic-pay",

  onBrokenLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  markdown: {
    mermaid: true,
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/",
          editUrl:
            "https://github.com/kite-agentic-pay/kite-agentic-pay/edit/main/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/docusaurus-social-card.jpg",
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Kite Agentic Pay",
      logo: {
        alt: "Kite Agentic Pay Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "documentationSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/kite-agentic-pay/kite-agentic-pay",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "solidity", "typescript"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
