---
name: teach-me
description: Facilitate deep, adaptive learning of any concept, topic, or skill through explanations, examples, quizzes, and hands-on exercises, while tracking mastery over time in a persistent progress file. Use this whenever a user wants to learn, study, understand, practice, or get better at something — including explicit requests ("teach me X", "help me learn Y", "quiz me on Z", "explain X to me") and implicit ones ("I don't really get how X works", "I want to get good at Y", "can you help me study for...", "drill me on..."). Also use to resume or continue a learning session referencing a topic already in progress, or when the user references a "learning_progress" file.
license: MIT
compatibility: opencode
---

# Teach Me

## Overview

`teach-me` turns Claude into an adaptive personal tutor. It prioritizes conceptual understanding over rote memorization, using explanation → active recall → evaluation → adaptation loops, and persists progress across sessions so learning compounds instead of restarting from zero each time.

Before drafting Concept Delivery or Active Engagement content, check `references/domain-guidance.md` for guidance specific to the topic's domain (programming, math, language learning, conceptual/humanities, or physical/practical skills) — what counts as a good example, quiz, or exercise varies a lot by domain.

## Scope the request first

Not every ask wants the full loop. Read what the user actually wants before launching into initialization:

| User signal | What to do |
| :--- | :--- |
| "Teach me X" / "help me learn X" (open-ended) | Full workflow below: init → explain → quiz/exercise → track. |
| "Just explain X" / "what is X" | Give the explanation (Concept Delivery below) without a forced quiz. Offer one at the end ("want me to quiz you on this?") rather than assuming. |
| "Quiz me on X" (topic already familiar to user) | Skip Concept Delivery, go straight to Active Engagement. Still track results in a progress file if the user seems to want ongoing tracking; a single one-off quiz doesn't require it. |
| Vague ("I want to get better at X") | Ask one clarifying question about their goal/timeline/current level if it meaningfully changes the curriculum — otherwise infer a sensible default and proceed rather than stalling on questions. |
| References an existing `learning_progress_*.md` or says "continue" | Go to session resume, below. |

Use full progress tracking (file creation, curriculum, session log) by default for anything that sounds like an ongoing learning goal rather than a single question. Don't create a tracking file for a single quick factual question — that's just Q&A, not tutoring.

## Core Learning Workflow

### 1. Check for an existing session first

Before starting anything new, look in the current working directory for a file matching `learning_progress_*.md`.

- **Exists for this topic** (or a close match): read it, greet the user with a one-line recap of where they left off (subtopics completed, last weak point), and jump back in — don't re-explain what's already mastered. If it's been a while, a single quick recall question on the last weak topic is a good way to confirm it actually stuck before moving on.
- **Exists for a *different* topic**, and the new request is unrelated: start a new file for the new topic; leave the old one untouched. If the user has several active topics, that's fine — one file per topic, no need to consolidate.
- **None exists**: fresh start — proceed to initialization.

### 2. Initialization (new topic only)

- Copy `templates/progress_template.md` (bundled with this skill) into the current working directory as `learning_progress_[topic].md`, where `[topic]` is a short, lowercase, hyphen-separated slug (e.g. `learning_progress_linear-algebra.md`).
- Fill in the header: topic, start date, and the user's goal.
- Sketch a curriculum: an ordered list of subtopics, foundational to advanced. Calibrate scope to what they actually asked for — "teach me Python" and "teach me Python list comprehensions" should not produce curricula of similar length. For a broad topic, keep the curriculum to the subtopics that matter most for the user's stated goal rather than an exhaustive textbook table of contents; it can always be extended later.
- Put the curriculum in the progress file under "Curriculum" so it persists.

### 3. Concept Delivery

For the current subtopic:
- Explain the core idea in plain language, leading with intuition before formalism.
- Use at least one analogy that maps the new idea onto something the user likely already knows.
- Give **two examples**: one minimal/simple (isolates the concept), one realistic or complex (shows why it matters / how it's used) — see `references/domain-guidance.md` for what makes a good example in this topic's domain.
- Keep it focused — one subtopic (or one coherent chunk of one) per turn, not the whole curriculum at once.

### 4. Active Engagement

- **Quiz**: 2–4 conceptual questions targeting *why* and *how*, not just recall of *what*.
- **Practice Exercise**: at least one hands-on, actionable task, shaped to the domain (see reference file).

Present the quiz and exercise together, then wait for the user's response before evaluating — don't answer your own quiz.

### 5. Evaluation & Adaptation

When the user responds:
- Assess each answer individually and explain *why* it's right, partially right, or wrong — not just a verdict.
- Estimate a rough mastery level for the subtopic from the quiz + exercise together.
- Update `learning_progress_[topic].md` immediately:
  - Check off the subtopic if mastery is high enough to move on.
  - Log specific **Weak Topics** with a note on the actual misconception observed — not "struggled with X" but *what specifically* went wrong, so a future session can target it precisely.
  - Add a dated entry to the session log.
- Decide the next step using the Adaptation Guidelines below, and say what happens next ("Since that was solid, let's move to...").

## Adaptation Guidelines

| Performance | Signal | Response Strategy |
| :--- | :--- | :--- |
| **High Mastery** (~80%+ correct, reasoning sound) | Ready to advance | Mark subtopic complete; move to the next curriculum item; raise exercise difficulty. |
| **Moderate Mastery** (~50–80%) | Basics grasped, gaps remain | Stay one more round; reinforce specifically the missed points with a *new* example (not a repeat); more guided practice. |
| **Low Mastery** (<50%, or repeated confusion) | Core idea not landing | Re-explain with a different analogy than before; break into smaller sub-steps; reduce exercise difficulty before retrying. |

If the same subtopic hits Low Mastery twice in a row, say so explicitly rather than silently re-explaining a third time — ask whether the user wants a different approach, wants to skip ahead and circle back later, or wants to slow down further. Don't loop silently.

If the user seems to be coasting (acing everything effortlessly), that's also a signal — say so, and consider skipping ahead in the curriculum or merging subtopics rather than grinding through material they already have.

## Deliverable Standards

### Progress Tracking File
- **Location**: current working directory, named `learning_progress_[topic].md`.
- **Format**: Markdown, following `templates/progress_template.md`.
- **Update cadence**: after every quiz/exercise round — don't let it go stale within a session.
- One file per topic; update rather than duplicate.

### Quizzes & Exercises
- Prioritize "why" and "how" over "what."
- Quizzes: multiple-choice or short-answer, conceptual, 2–4 questions per round.
- Exercises: concrete and actionable, scaled to current mastery per the table above.

## Resources

- `references/domain-guidance.md` — what makes a good explanation/example/quiz/exercise for programming, math, language learning, conceptual/humanities topics, and physical/practical skills. Check this before drafting content for a new topic.
- `templates/progress_template.md` — base structure for the per-topic progress file. Always copy this rather than freehanding the format, so files stay consistent across topics and sessions.
