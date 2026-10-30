// The end-of-training quiz. Every answer comes from the safe method cards
// the person has just read (src/lib/methods/content.ts), and each question
// names the card it tests. A wrong answer shows why and goes back in the
// queue, so nobody finishes without getting every question right.

export type QuizQuestion = {
  id: string;
  method: string; // the safe method card it comes from
  question: string;
  options: string[];
  answer: number; // index into options
  why: string;
};

export const QUIZ_ID = "training-quiz";

export const QUIZ: QuizQuestion[] = [
  {
    id: "fridge-legal", method: "chilled-storage",
    question: "By law, chilled food must be kept at or below…",
    options: ["8°C", "12°C", "15°C", "Room temperature is fine"],
    answer: 0, why: "Chilled food must stay at 8°C or below. Fridges should be set to 5°C or below.",
  },
  {
    id: "fridge-warm", method: "chilled-storage",
    question: "A fridge reads 11°C. What do you do?",
    options: ["Nothing, it will cool down", "Move the food to another fridge or a cold place, and tell the manager", "Turn the fridge off and on", "Put a sign on it"],
    answer: 1, why: "Over 8°C: move the food somewhere cold and tell the manager. Write what you did in the app.",
  },
  {
    id: "cook-temp", method: "cooking-safely",
    question: "Sausage rolls come out of the oven. The middle must reach at least…",
    options: ["50°C", "63°C", "75°C", "100°C"],
    answer: 2, why: "Safe is 75°C in the middle for at least 30 seconds. Probe the middle of one.",
  },
  {
    id: "cooling-clock", method: "chilling-down",
    question: "Sausage rolls are cooling on the side to sell warm. How long do they have?",
    options: ["2 hours: then chilled counter, sold or bin", "4 hours", "Until the end of the day", "As long as they look fine"],
    answer: 0, why: "Our rule is 2 hours from the oven. By then they go in the chilled counter, are sold, or go in the bin.",
  },
  {
    id: "cooling-late", method: "chilling-down",
    question: "A tray has been out of the oven for 2 and a half hours. What happens to it?",
    options: ["Put it in the fridge", "Sell it quickly", "Bin it", "Reheat it and sell it"],
    answer: 2, why: "Over 2 hours, it goes in the bin.",
  },
  {
    id: "hot-hold", method: "hot-holding",
    question: "Hot food kept hot for sale must stay at or above…",
    options: ["40°C", "63°C", "75°C", "It just needs to feel warm"],
    answer: 1, why: "Hot holding is 63°C or above. That's the law.",
  },
  {
    id: "sandwich-time", method: "sandwiches-out",
    question: "Sandwiches go out on the counter at 8am. By our shop rule, they come off by…",
    options: ["11am (3 hours)", "12 noon (4 hours)", "2pm", "Closing time"],
    answer: 0, why: "Our rule is 3 hours at most. The legal limit is under 4 hours, once only.",
  },
  {
    id: "sandwich-unknown", method: "sandwiches-out",
    question: "You find sandwiches on the counter and nobody knows when they came out. What do you do?",
    options: ["Put them back in the fridge", "Bin them", "Leave them", "Sell them cheaper"],
    answer: 1, why: "If you don't know how long they've been out, bin them.",
  },
  {
    id: "ill", method: "fit-for-work",
    question: "You were sick last night. What do you do?",
    options: ["Come in but wear gloves", "Tell the manager and stay home until 48 hours after your last symptoms", "Come in if you feel better this morning", "Only work on the till"],
    answer: 1, why: "Sick or diarrhoea: tell the manager, stay away, and only come back 48 hours after it stops.",
  },
  {
    id: "gloves", method: "hand-washing",
    question: "Do gloves mean you don't need to wash your hands?",
    options: ["Yes, gloves are enough", "No, wash your hands before you put gloves on and after you take them off", "Only if they're new gloves", "Only for raw meat"],
    answer: 1, why: "Gloves do not replace washing. Wash before putting them on and after taking them off.",
  },
  {
    id: "sanitiser", method: "two-stage-clean",
    question: "Cleaning a worktop. What's the right way?",
    options: ["Spray sanitiser and wipe straight off", "Clean off the dirt first, then sanitiser, left on for the time on the label", "Just hot water", "Wipe with a tea towel"],
    answer: 1, why: "Two stages: clean first, then disinfect, and leave the sanitiser on for its full contact time.",
  },
  {
    id: "allergy", method: "customers-allergies",
    question: "A customer asks if something has nuts in it and you're not sure. What do you say?",
    options: ["\"It should be fine\"", "\"I don't know. Let me check the Allergen Guide and ask the manager\"", "\"Just pick the nuts out\"", "\"Nothing here has nuts\""],
    answer: 1, why: "Never guess. Check the Allergen Guide and the label, and ask the manager.",
  },
  {
    id: "pests", method: "pest-control",
    question: "You see mouse droppings behind the flour. What do you do?",
    options: ["Sweep them up and carry on", "Tell the manager straight away, and don't use food a pest may have touched", "Ignore it if it's only a few", "Tell someone at the end of the day"],
    answer: 1, why: "Report it straight away. Food a pest may have touched goes in the bin; surfaces get washed and disinfected.",
  },
];

// The order options are shown in, shuffled per question so nobody learns
// "it's always B". Deterministic from a seed, so a re-render doesn't reshuffle.
export function optionOrder(q: QuizQuestion, seed: number): number[] {
  const order = q.options.map((_, i) => i);
  let s = (seed ^ [...q.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)) >>> 0;
  for (let i = order.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// After an answer: right → the question leaves the queue; wrong → it goes to
// the back, to be answered again.
export function nextQueue(queue: string[], answeredId: string, correct: boolean): string[] {
  const rest = queue.filter((id) => id !== answeredId);
  return correct ? rest : [...rest, answeredId];
}
