# Smart Quiz App project rules

- Build a local-first study app for students to organize their own questions and answers.
- Do not add a backend, paid AI API, account registration, or other project unrelated to this app.
- Store subjects, quizzes, questions, score history, and study progress separately in IndexedDB.
- Provide JSON backup and restore for user data.
- Let users create subject folders and multiple custom-named quizzes in each folder. Support renaming, editing, deleting, moving, and retaking saved quizzes.
- Allow question imports from PDF, DOCX, and pasted text. Use free client-side libraries for PDF and DOCX text extraction.
- Clearly warn when a file is unsupported or appears to be scanned and cannot be read as text.
- Never invent or silently fill in missing questions or correct answers. Let users review, correct, and approve imported questions before saving; flag unclear content for the user's review.
- Support multiple-choice questions with answer keys.
- Present one question at a time, track correct and incorrect answers, and repeat incorrectly answered questions after the first round until they are answered correctly.
- Keep the interface clean, responsive, accessible, and easy to use on small and large screens.
- Make focused changes, preserve user data, and validate behavior with relevant tests before considering a feature complete.
