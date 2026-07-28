# Arcsmith walkthrough

This script is designed for a concise 3 to 4 minute submission video.

## 0:00 to 0:30: product and architecture

Open Arcsmith and explain that it is a multimodal support agent for the Vulcan OmniPro 220, not a generic PDF chatbot. Show that answers combine cited manufacturer pages with trusted interactive React artifacts.

Briefly point to the architecture in the README: Claude can use only seven in-process product tools, while the server's evidence ledger validates citations and reconstructs technical output from verified records.

## 0:30 to 1:15: exact duty cycle

Select the starter:

> What's the duty cycle for MIG welding at 200 A on 240 V?

Show the exact 25% answer, the 2.5-minute weld and 7.5-minute rest visualization, and owner-manual page 19. Move the amperage control between the published points and emphasize that Arcsmith refuses to interpolate an unpublished value.

## 1:15 to 2:00: physical connection routing

Ask:

> What polarity setup do I need for TIG? Which socket does the ground clamp go in?

Show the physical positive and negative sockets, the torch and clamp routes, the screen confirmation step, and the cited page. Contrast this briefly with self-shielded flux-core to demonstrate that process-specific polarity is kept separate.

## 2:00 to 2:45: interactive settings

Ask:

> What settings should I use?

Show that Arcsmith asks for missing inputs instead of inventing numbers. Set the process, input voltage, material, thickness, and consumable in the configurator, then apply the completed setup back to chat. Explain that the machine's Auto Weld screen remains authoritative for the final output.

## 2:45 to 3:20: troubleshooting

Ask:

> I'm getting porosity in my weld.

Show the clarification between gas-shielded MIG and self-shielded flux-core. Choose one path and walk through the interactive checklist and cited manual visual. Point out that gas checks are excluded from the self-shielded path.

## 3:20 to 3:45: verification

Close on the repository's test and CI sections:

- 36 automated cases, with the live SDK case explicitly gated by an Anthropic key
- visual-integrity regression coverage for the full selection chart
- TypeScript and production build checks
- Docker image build in GitHub Actions

End with the hosted demo URL and fork URL.
