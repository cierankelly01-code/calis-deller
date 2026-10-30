"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { QUIZ, nextQueue, optionOrder } from "@/lib/training/quiz";

// One question at a time. Right: well done, next. Wrong: here's the right
// answer and why, and the question comes back later. Finished only when the
// queue is empty, i.e. every question has been answered right.

export function Quiz({ onPass, saving }: { onPass: () => void; saving: boolean }) {
  const [queue, setQueue] = useState<string[]>(() => QUIZ.map((q) => q.id));
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [picked, setPicked] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const current = QUIZ.find((q) => q.id === queue[0]) ?? null;
  const rightSoFar = QUIZ.length - queue.length;

  if (!current) {
    return (
      <div className="rounded-3xl bg-brand text-white p-6 text-center space-y-3">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/15"><Icon name="check" size={34} strokeWidth={2.5} /></span>
        <p className="text-2xl font-bold">All {QUIZ.length} right</p>
        <p className="text-white/85">{mistakes === 0 ? "Not one wrong. Brilliant." : "You got there. That's what counts."}</p>
        <button type="button" disabled={saving} onClick={onPass} className="w-full h-14 rounded-2xl bg-white text-brand-deep text-lg font-bold disabled:opacity-50">{saving ? "Saving…" : "Finish my training"}</button>
      </div>
    );
  }

  const order = optionOrder(current, seed);
  const answered = picked !== null;
  const correct = picked === current.answer;

  function next() {
    if (picked === null || !current) return;
    if (!correct) setMistakes((m) => m + 1);
    setQueue((q) => nextQueue(q, current.id, correct));
    setPicked(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="rounded-3xl bg-surface border-2 border-brand/30 p-5 space-y-4">
      <div className="flex items-center justify-between text-sm font-semibold text-ink-soft">
        <span>Quiz · {rightSoFar} of {QUIZ.length} right</span>
        <span>{queue.length} to go</span>
      </div>
      <div className="h-2 rounded-full bg-paper overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${(rightSoFar / QUIZ.length) * 100}%` }} /></div>
      <p className="text-[22px] leading-snug font-bold text-ink">{current.question}</p>
      <div className="space-y-2.5">
        {order.map((i) => {
          const isPicked = picked === i;
          const isAnswer = i === current.answer;
          const style = !answered
            ? "bg-paper border-line text-ink"
            : isAnswer
              ? "bg-brand-soft border-brand text-brand-deep"
              : isPicked
                ? "bg-danger-soft border-danger text-danger-deep"
                : "bg-paper border-line text-ink-faint";
          return (
            <button key={i} type="button" disabled={answered} onClick={() => setPicked(i)} className={`w-full min-h-16 rounded-2xl border-2 px-4 py-3 text-left text-[17px] font-semibold flex items-center gap-3 ${style}`}>
              <span className="flex-1">{current.options[i]}</span>
              {answered && isAnswer && <Icon name="check" strokeWidth={2.5} />}
              {answered && isPicked && !isAnswer && <Icon name="cross" strokeWidth={2.5} />}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`rounded-2xl px-4 py-3 ${correct ? "bg-brand-soft" : "bg-danger-soft"}`} role="status">
          <p className={`font-bold ${correct ? "text-brand-deep" : "text-danger-deep"}`}>{correct ? "Correct" : "Not quite. This one will come back."}</p>
          <p className="text-ink mt-0.5">{current.why}</p>
        </div>
      )}
      {answered && (
        <button type="button" onClick={next} className="w-full h-14 rounded-2xl bg-brand text-white text-lg font-bold flex items-center justify-center gap-2">
          {correct ? "Next question" : "OK, next"} <Icon name="arrow" size={20} />
        </button>
      )}
    </div>
  );
}
