// Hover / tap detail cards. Every statement is from the lecture slides or the cited textbook.
const L = (n) => `Lecture slide ${n}`;
const G = 'Guyton & Hall 15e — Pulmonary Ventilation';
const G43 = 'Guyton & Hall 15e — Respiratory Insufficiency';

export const POPS = {
  /* ---------- learning objectives ---------- */
  'lo-vol': { kicker: 'Objectives 1 – 4', title: 'Lung volumes & spirometry', color: 'blue', rows: [
    ['1', 'Label the <b>4 volumes</b> and <b>4 capacities</b> on a normal spirogram'],
    ['2', 'Volumes & capacities that <b>spirometry cannot measure</b>'],
    ['3', 'The spirogram of a <b>forceful maximal expiration</b>'],
    ['4', 'Analyse <b>FVC, FEV₁, PEFR, FEF<sub>25–75%</sub></b> on a graph'],
  ], src: L('2–3') },
  'lo-press': { kicker: 'Objectives 6 · 7', title: 'Pressures & the breathing cycle', color: 'pink', rows: [
    ['6', 'Pleural & alveolar pressure, airflow and lung volume during a <b>quiet breath</b>'],
    ['7', 'How the <b>atmosphere–alveolar pressure difference</b> moves air'],
  ], src: L('2–3') },
  'lo-comp': { kicker: 'Objectives 8 – 11', title: 'Compliance & elastic recoil', color: 'purple', rows: [
    ['8', 'The normal <b>pressure–volume (compliance) curve</b>'],
    ['9', 'P–V curves of <b>lungs, chest wall</b> and <b>whole system</b>'],
    ['10', 'Why each <b>resting position</b> matters'],
    ['11', 'What makes <b>intrapleural pressure negative</b> at FRC — and <b>pneumothorax</b>'],
  ], src: L('2–3') },
  'lo-surf': { kicker: 'Objectives 12 · 13', title: 'Surface tension & surfactant', color: 'cyan', rows: [
    ['12', 'Surface tension, <b>alveolar size</b> and the role of <b>surfactant</b>'],
    ['13', '<b>Atelectasis</b> and how surfactant prevents it'],
  ], src: L('2–3') },
  'lo-res': { kicker: 'Objectives 5 · 14 · 15', title: 'Resistance, effort & work', color: 'orange', rows: [
    ['5', 'Why <b>more effort</b> can fail to raise expiratory flow'],
    ['14', 'Airway diameter, <b>turbulence</b>, resistance & <b>dynamic compliance</b>'],
    ['15', 'Compliance & resistance vs the <b>work of breathing</b>'],
  ], src: L('2–3') },
  'lo-dis': { kicker: 'Objective 16', title: 'Obstructive vs restrictive', color: 'green', rows: [
    ['16', 'The two broad disease categories and their <b>spirometric patterns</b>'],
  ], src: L('2–3') },

  /* ---------- pressures ---------- */
  'p-pao': { kicker: 'Pressure', title: 'P<sub>ao</sub> · airway opening', color: 'blue', rows: [
    ['≡', 'Pressure at the airway opening (mouth / nose)'],
    ['≈', 'Generally equal to <b>atmospheric</b> pressure (P<sub>B</sub>) — but not always'],
  ], src: L(5) },
  'p-ppl': { kicker: 'Pressure', title: 'P<sub>pl</sub> · pleural pressure', color: 'green', rows: [
    ['≡', 'Pressure of the fluid in the thin space between lung pleura and chest-wall pleura'],
    ['↕', 'Varies throughout the pulmonary system'],
    ['#', 'Slightly negative at rest — about <b>−5 cm H₂O</b> at the start of inspiration'],
  ], src: `${L(5)} · ${G}` },
  'p-pa': { kicker: 'Pressure', title: 'P<sub>A</sub> · alveolar pressure', color: 'pink', rows: [
    ['≡', 'Pressure of the air inside the alveoli'],
    ['0', 'Equals atmospheric when the glottis is open and no air is flowing'],
    ['↕', 'Below atmospheric in inspiration · above it in expiration'],
  ], src: `${L(5)} · ${G}` },
  'p-pbs': { kicker: 'Pressure', title: 'P<sub>bs</sub> · body surface', color: 'purple', rows: [
    ['≡', 'Pressure acting on the outside of the chest wall'],
    ['≈', 'Usually equal to P<sub>ao</sub>'],
  ], src: L(5) },
  transmural: { kicker: 'Lecture figure', title: 'Transmural pressure', color: 'green', formula: 'P<sub>TM</sub> = P<sub>inside</sub> − P<sub>outside</sub>', rows: [
    ['+', 'Positive → the airway is <b>distended</b> (held open)'],
    ['A', 'Pre-inspiration: 0 − (−5) = <b>+5</b> cm H₂O'],
    ['D', 'Forced expiration: +19 − (+30) = <b class="c-red">−11</b> → airway <b>compressed</b>'],
  ], src: `${L(8)} (figure) · values in cm H₂O` },

  /* ---------- four factors ---------- */
  'f-size': { kicker: 'Factor 1', title: 'Size', color: 'blue', rows: [
    ['≡', 'Lung volume — depends on sex, race and height'],
    ['→', 'Changing volume changes alveolar pressure (Boyle)'],
  ], src: L('9–10') },
  'f-comp': { kicker: 'Factor 2', title: 'Compliance', color: 'green', formula: 'C = ΔV ÷ ΔP', rows: [
    ['≡', 'How easy it is to <b>increase</b> lung volume'],
  ], src: L(9) },
  'f-elast': { kicker: 'Factor 3', title: 'Elastance (recoil)', color: 'purple', formula: 'Elastance ∝ 1 ÷ Compliance', rows: [
    ['≡', 'How readily the lungs <b>return to resting volume</b> after inhalation stops'],
  ], src: L('9, 11') },
  'f-res': { kicker: 'Factor 4', title: 'Resistance to airflow', color: 'orange', formula: 'Flow = ΔP ÷ R', rows: [
    ['≡', 'How easy it is for air to <b>move through the airways</b>'],
  ], src: L(9) },

  /* ---------- Boyle / Darcy ---------- */
  boyle: { kicker: 'Gas law', title: "Boyle's law", color: 'blue', formula: 'P₁V₁ = P₂V₂', rows: [
    ['T', 'Temperature constant'],
    ['⇅', 'Pressure and volume vary <b>inversely</b>'],
    ['?', 'True for a <b>closed</b> system. Are lungs closed? <b>No</b> — the airway is open, so the pressure change drives airflow until P<sub>A</sub> = P<sub>atm</sub>.'],
  ], src: L(10) },
  darcy: { kicker: 'Flow law', title: "Darcy's law", color: 'orange', formula: 'Flow = (P<sub>A</sub> − P<sub>atm</sub>) ÷ R', rows: [
    ['⚡', 'Same form as <b>Ohm\'s law</b>: current = voltage ÷ resistance'],
    ['0', 'No pressure difference → no airflow'],
  ], src: L(10) },
  'elastic-q': { kicker: 'Think', title: 'Is a highly elastic tissue easy to expand?', color: 'purple', rows: [
    ['No', 'High elastance = strong recoil = <b>low compliance</b>'],
    ['∝', 'Compliance ∝ 1 ÷ elastance'],
  ], src: L(11) },

  /* ---------- recoil ---------- */
  elastin: { kicker: 'Recoil source 1', title: 'Elastic fibres', color: 'green', rows: [
    ['≡', '<b>Elastin</b> and <b>collagen</b> fibres in alveolar walls, around vessels and bronchi'],
    ['→', 'Stretched on inspiration, they recoil on expiration'],
    ['⅓', 'About <b>one-third</b> of total lung recoil'],
  ], src: `${L(12)} · ${G}` },
  'surface-tension': { kicker: 'Recoil source 2', title: 'Surface tension', color: 'blue', rows: [
    ['≡', 'Water molecules at the air–fluid surface pull toward each other'],
    ['→', 'The alveolus tries to <b>collapse</b> — pressure inside the bubble > outside'],
    ['⅔', 'About <b>two-thirds</b> of total lung recoil'],
  ], src: `${L(12)} · ${G}` },
  laplace: { kicker: 'For one surface', title: "Laplace's law", color: 'blue', formula: 'P = 2T ÷ r', rows: [
    ['P', 'Collapsing pressure in the alveolus'],
    ['T', 'Surface tension of the lining fluid'],
    ['r', 'Radius — <b>smaller alveolus → higher pressure</b>'],
  ], src: L(12) },

  /* ---------- surfactant ---------- */
  monolayer: { kicker: 'Think', title: 'Why a monolayer?', color: 'cyan', rows: [
    ['◐', 'DPPC has a <b>polar (water-loving) head</b> and <b>non-polar tails</b>'],
    ['→', 'Heads dissolve in the alveolar fluid; tails face the air — one layer at the surface'],
    ['↓', 'This air–lipid surface has far less surface tension'],
  ], src: `${L(14)} · ${G}` },
  atelectasis: { kicker: 'Clinical', title: 'Atelectasis', color: 'red', rows: [
    ['≡', '<b>Collapse</b> of alveoli'],
    ['!', 'Reduced surfactant → difficult inhalation, collapse'],
    ['→', 'After <b>drowning</b> · <b>premature infants</b> (&lt; 37 weeks)'],
  ], src: L(15) },

  /* ---------- compliance ---------- */
  'ppl-neg': { kicker: 'Intrapleural pressure', title: 'Why is it negative?', color: 'green', rows: [
    ['←', 'Lung elastic recoil pulls <b>inward</b>'],
    ['→', 'Chest wall recoil pulls <b>outward</b>'],
    ['#', 'The sealed pleural space between them is sub-atmospheric: ≈ <b>−5 cm H₂O</b>'],
    ['!', 'Open it to air → the two separate: <b>pneumothorax</b>'],
  ], src: `${L('18, 43')} · ${G}` },

  /* ---------- spirometry ---------- */
  'spiro-pen': { kicker: 'The “?” on the lecture slide', title: 'Which way does the pen move?', color: 'orange', rows: [
    ['↑', 'Exhale → air enters the bell → <b>bell rises</b>'],
    ['↓', 'Chain over the pulleys → <b>counterweight & pen fall</b>'],
    ['→', 'So inspiration records as an <b>upward</b> deflection'],
  ], src: L(22) },
  'measure-rv': { kicker: 'Beyond spirometry', title: 'Measuring RV, FRC, TLC', color: 'orange', rows: [
    ['He', '<b>Helium dilution</b> (Guyton) — also nitrogen washout or body plethysmography'],
    ['ƒ', 'FRC = ERV + RV'],
    ['ƒ', 'TLC = VC + RV'],
  ], src: `${L(26)} · ${G}` },

  /* ---------- resistance ---------- */
  poiseuille: { kicker: 'Laminar flow', title: "Poiseuille's law", color: 'orange', formula: 'R = 8Lη ÷ πr⁴', rows: [
    ['r⁴', 'Halve the radius → <b>16×</b> resistance'],
    ['L', 'Longer tubes → greater resistance'],
    ['η', 'Thicker fluids → more internal resistance'],
  ], src: L(28) },
  'bm-para': { kicker: 'Constrictor', title: 'Parasympathetic', color: 'red', rows: [
    ['ACh', 'Vagal acetylcholine on <b>muscarinic M3</b> receptors'],
    ['→', 'Bronchial smooth muscle contracts'],
  ], src: `${L(29)} · ${G}` },
  'bm-hist': { kicker: 'Constrictor', title: 'Histamine', color: 'red', rows: [
    ['≡', 'Released by mast cells in allergic reactions'],
    ['→', 'Bronchiolar constriction — prominent in asthma'],
  ], src: `${L(29)} · ${G}` },
  'bm-lt': { kicker: 'Constrictor', title: 'Leukotrienes', color: 'red', rows: [
    ['≡', '“Slow-reacting substance of anaphylaxis”'],
    ['→', 'Potent bronchoconstriction in allergic asthma'],
  ], src: `${L(29)} · ${G}` },
  'bm-b2': { kicker: 'Dilator', title: 'Sympathetic · β₂', color: 'green', rows: [
    ['≡', 'Mainly circulating <b>epinephrine</b> on <b>β₂</b>-adrenergic receptors'],
    ['→', 'Smooth muscle relaxes → airway <b>dilates</b>'],
  ], src: `${L(29)} · ${G}` },
  'two-recoil': { kicker: 'Remember', title: 'The two factors behind recoil', color: 'yellow', rows: [
    ['1', 'Elastic fibres'],
    ['2', 'Surface tension'],
    ['!', 'Emphysema destroys elastin → less pull on airway walls → <b>narrower airways</b>'],
  ], src: L('12, 31') },
  heliox: { kicker: 'Density', title: 'Helium + O₂', color: 'green', rows: [
    ['ρ', 'Helium is much <b>less dense</b> than nitrogen'],
    ['→', 'Less turbulence-driven resistance'],
    ['✚', 'Used in <b>diving</b> and for <b>patients</b>'],
  ], src: L(32) },

  /* ---------- flow-volume ---------- */
  pefr: { kicker: 'Index', title: 'PEFR', color: 'blue', rows: [
    ['≡', '<b>Peak expiratory flow rate</b> — the highest flow, reached early'],
    ['!', '<b>Effort-dependent</b>'],
  ], src: L('38–39') },
  fvc: { kicker: 'Index', title: 'FVC', color: 'green', rows: [
    ['≡', '<b>Forced vital capacity</b> — total volume blown out from full inspiration'],
  ], src: L(38) },
  fev1: { kicker: 'Index', title: 'FEV₁', color: 'cyan', rows: [
    ['≡', 'Volume exhaled in the <b>first second</b> of a forced expiration'],
  ], src: L(38) },
  ratio: { kicker: 'Index', title: 'FEV₁ / FVC', color: 'yellow', rows: [
    ['#', 'Normally about <b>80%</b>'],
    ['↓', 'Low in <b>obstructive</b> disease'],
    ['≈', 'Normal in <b>restrictive</b> disease (flow rates normal)'],
  ], src: `${L('38, 40')} · ${G43}` },
  fef: { kicker: 'Index', title: 'FEF<sub>25–75%</sub>', color: 'pink', rows: [
    ['≡', 'Mean flow from 25% to 75% of the FVC exhaled'],
    ['!', 'Low in obstructive disease'],
  ], src: L('38, 40') },
  'dyn-comp': { kicker: 'Objective 5', title: 'Dynamic airway compression', color: 'red', rows: [
    ['+', 'Forced expiration makes pleural pressure <b>positive</b> (+30 in the figure)'],
    ['→', 'It squeezes the <b>airways</b> as well as the alveoli'],
    ['−', 'Airway transmural pressure turns negative (<b>−11</b>) → airway narrows'],
    ['=', 'More effort → more compression → flow hits a <b>maximum</b>'],
  ], src: `${L(8)} (figure) · ${G43}` },

  /* ---------- disease ---------- */
  'fib-tlc': { kicker: 'Fibrosis', title: 'TLC — small ↓', color: 'purple', rows: [['→', 'Enhanced lung recoil — muscles <b>cannot expand</b> the system normally']], src: L(41) },
  'fib-frc': { kicker: 'Fibrosis', title: 'FRC — large ↓', color: 'purple', rows: [['→', '<b>More lung recoil</b> to counterbalance chest recoil']], src: L(41) },
  'fib-rv': { kicker: 'Fibrosis', title: 'RV — unaffected', color: 'purple', rows: [['→', 'Enhanced recoil <b>helps exhalation</b>'], ['ⓘ', 'Literature note: clinical references usually report RV <b>normal or ↓</b> in fibrosis']], src: `${L(41)} · MSD Manual — physiologic changes in pulmonary disorders` },
  'emp-tlc': { kicker: 'Emphysema', title: 'TLC — small ↑', color: 'orange', rows: [['→', 'Less lung recoil — muscles expand the system <b>further than normal</b>']], src: L(42) },
  'emp-frc': { kicker: 'Emphysema', title: 'FRC — large ↑', color: 'orange', rows: [['→', '<b>Less lung recoil</b> to counterbalance chest recoil']], src: L(42) },
  'emp-rv': { kicker: 'Emphysema', title: 'RV — ↑', color: 'orange', rows: [['→', 'Hinders exhalation → <b>air trapping</b>']], src: L(42) },

  /* ---------- literature notes (lecture value kept, nuance cited) ---------- */
  'note-cycle': { kicker: 'Literature note', title: 'Units & values', color: 'yellow', rows: [
    ['L', 'Numbers follow <b>lecture slides 7–8</b>; the source figure is plotted in <b>mm Hg</b>'],
    ['G', 'Guyton & Hall: pleural ≈ <b>−5 → −7.5 cm H₂O</b> during inspiration; alveolar ≈ <b>−1 / +1 cm H₂O</b>'],
  ], src: `${L('7–8')} · ${G}` },
  'note-comp': { kicker: 'Literature note', title: 'Surfactant composition', color: 'yellow', rows: [
    ['L', 'Lecture: <b>90%</b> lipid · <b>8%</b> protein · <b>2%</b> carbohydrate'],
    ['R', 'Reviews: ≈ <b>90% lipid · 10% protein</b> (DPPC the main lipid)'],
  ], src: `${L(14)} · Agassandian & Mallampalli, BBA 2013 (PMC4418337)` },
  'note-turn': { kicker: 'Literature note', title: 'Surfactant turnover', color: 'yellow', rows: [
    ['L', 'Lecture: half-life ≈ <b>2 days</b>'],
    ['R', '≈ 2–4 days is reported in <b>preterm infants</b>; adult turnover is faster (hours)'],
  ], src: L(14) },
  'note-25': { kicker: 'Literature note', title: 'When does production start?', color: 'yellow', rows: [
    ['L', 'Lecture: from <b>week 25</b>; glucocorticoids essential'],
    ['R', 'First appears ≈ <b>22–24 weeks</b>; antenatal corticosteroids <b>accelerate</b> lung maturation'],
  ], src: `${L(13)} · Cell Tissue Res 2017 (doi:10.1007/s00441-016-2545-0)` },
  'note-o2': { kicker: 'Literature note', title: 'Gases in small airways', color: 'yellow', rows: [
    ['L', 'Lecture lists ↓O₂ and ↑CO₂ in small airways as dilators'],
    ['R', 'Standard texts stress <b>CO₂</b>: ↑CO₂ → dilation, ↓CO₂ → constriction (matches ventilation to perfusion)'],
  ], src: `${L(29)} · Virginia Tech Pulmonary Physiology — airway resistance` },
};
