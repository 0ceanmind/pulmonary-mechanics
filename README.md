# Pulmonary Mechanics — interactive 3D lecture

An Apple-keynote-style, browser-based presentation of **Pulmonary Mechanics** (Guyton & Hall, *Textbook of Medical Physiology*, 15th ed., pp. 501–507; lecture by Dr Rajeev Bajaj), built for a large screen.

- **Deck:** https://0ceanmind.github.io/pulmonary-mechanics/
- **Question bank:** https://0ceanmind.github.io/pulmonary-mechanics/quiz/

## What's inside
- 40 slides, each mapped to its original lecture slide (click the "Lecture slide N" chip or press **S** to see it).
- Procedural Three.js models: breathing lungs & thorax (pressures, airflow, pneumothorax, fibrosis, emphysema), a water-seal bell spirometer that draws its own spirogram, Boyle's-law piston, Laplace alveoli with/without surfactant, Poiseuille tube, bronchial smooth muscle, radial traction, turbulent vs laminar flow.
- Live D3 charts: breathing cycle, P–V curves, FRC tug-of-war, spirogram, hysteresis, work of breathing, flow–volume loop, effort dependence, obstructive vs restrictive.
- Minimal on-screen text; hover the **+** buttons, terms and labels for detail cards with sources. Yellow **ⓘ** chips mark where the lecture's figure differs from current literature.
- 127 exam-style MCQs with practice/exam modes, explanations, slide references and topic scores.

## Presenter keys
| Key | Action |
| --- | --- |
| → / Space / PageDown | next build or slide |
| ← / PageUp | back |
| O / Esc | slide overview |
| F | fullscreen |
| T | light / dark theme |
| L | laser pointer |
| S | original lecture slide |
| Q | open the quiz |
| number + Enter | jump to slide |

## Run locally
Any static server works, e.g. `python -m http.server` in this folder, then open `http://localhost:8000/`. No build step; Three.js r160, D3 7 and the QR library are vendored in `vendor/`.

## Sources
Lecture slides (Dr Rajeev Bajaj, NU Oman); Guyton & Hall 15e — Pulmonary Ventilation; Ninja Nerd, Lecturio and Dr Matt & Dr Mike lectures listed on the final lecture slide. Fact-check notes: `dev/factcheck.md`.
