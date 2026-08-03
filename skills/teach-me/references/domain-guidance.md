# Domain-Specific Tutoring Guidance

The core loop (explain → engage → evaluate → adapt) is the same everywhere, but what counts as a good example, quiz, or exercise differs a lot by domain. Read the section that matches the current topic before drafting Concept Delivery or Active Engagement content.

## Programming / CS

- **Examples**: minimal example should be runnable in isolation (a few lines); complex example should resemble real code the user might actually write or encounter, not a toy that's complex for its own sake.
- **Quiz**: favor "what would this print/return and why" and "what's wrong with this snippet" over terminology recall.
- **Exercise**: always a concrete coding task with a clear success condition ("write a function that passes these cases: ..."). If the user has a code execution tool available in the environment, offer to actually run their solution and give real feedback instead of just eyeballing it.
- **Common failure mode to watch for**: user pattern-matches syntax without understanding semantics (e.g., can write a for-loop but can't say why it terminates). Probe for this explicitly with a "trace through this by hand" question.

## Math / Quantitative

- **Examples**: minimal example should isolate the mechanic with small, clean numbers; complex example should be a word problem or application (physics, finance, stats) that requires recognizing when to apply the concept, not just executing it.
- **Quiz**: include at least one "why does this method work" or "when would this fail" question, not only compute-the-answer questions.
- **Exercise**: a derivation, proof sketch, or multi-step problem. Ask the user to show their work, not just the final number — the work is where misconceptions surface.
- **Common failure mode**: memorized procedure without understanding what it's for. Test this by changing the surface features of a problem (different numbers, different framing) and seeing if they still recognize which method applies.

## Language Learning

- **Examples**: minimal example is a single clean sentence demonstrating the pattern; complex example is a short natural dialogue or passage showing it in context.
- **Quiz**: mix recognition (pick the correct form) and production (produce a sentence using the pattern) — production is the harder, more diagnostic skill.
- **Exercise**: have the user produce original sentences or a short paragraph, not just fill-in-the-blank. Gently correct errors inline rather than just marking wrong/right.
- **Common failure mode**: passive recognition outpaces active production for a long time — this is normal, but don't let quiz scores based only on recognition questions overstate mastery.

## Conceptual / Humanities / Soft Skills

(History, philosophy, economics, communication skills, etc.)

- **Examples**: minimal example is a clean, uncontested illustration of the idea; complex example should show the concept in a messier, real-world, possibly contested case — this is often where the real learning happens.
- **Quiz**: short-answer only tends to work better than multiple-choice here — ask the user to explain the idea in their own words, or apply it to a new scenario you provide.
- **Exercise**: a short written argument, a compare/contrast, or applying the framework to a case the user brings up themselves (their own job, a current event, etc.) — this connects the abstract idea to something they already care about.
- **Common failure mode**: user can recite the definition but can't apply it to a new case. Always include at least one "apply this to a situation I haven't shown you an example of" question.

## Physical / Practical Skills

(Cooking technique, instrument practice, sports mechanics, etc. — where the actual practice can't happen in a text chat)

- Be upfront that Claude can explain the mechanics, sequence a practice plan, and answer questions, but can't observe the user's actual physical execution.
- **Exercise** here should be a structured practice drill with clear self-check criteria the user can evaluate themselves against ("your wrist should stay flat through the follow-through — did it?").
- Ask the user to self-report or describe what happened, and coach based on their description, flagging that this is inherently lower-fidelity feedback than for a topic you can directly evaluate.

## When the topic doesn't cleanly fit one category

Blend the closest two rather than forcing a fit. State which approach you're taking if it's not obvious, so the user understands why the exercises look the way they do.
