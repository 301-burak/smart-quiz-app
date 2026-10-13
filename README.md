# Smart Quiz App

Smart Quiz App is a local-first study tool for organizing your own questions and answers. Start with the Math and English subject folders, or create your own subjects, then add custom-named quizzes. Imported questions are reviewed before saving so unclear or missing answers are not guessed.

## Run the app

The Quiz Library runs in the browser with no build step or backend. PDF.js and Mammoth are loaded only when you import their file formats.

- Open `index.html` directly in a current web browser, or
- Open the project folder in VS Code and use a local static-server extension such as Live Server.

Library data is stored in IndexedDB for the current browser, device, and site origin. Clearing browser site data will remove it. Opening the app from `file://` and opening it from GitHub Pages use different origins, so local data does not automatically appear at the Pages URL.

## Back up and restore

Choose **Export Backup** in the library to download a versioned JSON file containing subject folders, quizzes, questions and answer keys, unfinished or completed quiz progress, and score history. Keep the downloaded file somewhere safe; it is the portable copy of your local library.

To restore, choose **Import Backup**, select a Smart Quiz JSON file, and review its validation result and record-count preview. The app asks for confirmation before restoring and only adds records; it never replaces or deletes existing data. If any record IDs conflict with the current library, the entire restore is rejected without writing anything. Backups larger than 25 MB and unsupported or structurally invalid files are rejected.

## Deploy with GitHub Pages

The app is a static site and does not need a build step or backend. Its CSS, JavaScript, and home links use relative paths, so it works from either a user site or a repository project-site URL.

1. Put the project files (`index.html`, `app.js`, and `styles.css`) at the repository root and push the branch you want to deploy to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select the branch and **/(root)** folder, then save.
4. Wait for GitHub Pages to finish deploying and open the URL shown in the Pages settings.

This project has not been published by these instructions. PDF and DOCX imports load PDF.js and Mammoth from cdnjs, so those imports require an internet connection. The app itself and pasted-text imports remain client-side.

**Important before deployment:** IndexedDB is isolated by origin. Existing data in a local `file://` copy remains in that browser origin and is not available to the GitHub Pages site. Export a JSON backup before moving to a different origin, then restore it from the deployed app.

## Quiz Library

- Create subject folders and named quizzes, then rename, delete, or move them between folders.
- Keep quiz records and their questions in separate local database stores. Question authoring after import is planned for a later milestone.

## Take a quiz

Open a subject folder and select a quiz card to start it. Choose one answer at a time; answers and progress are saved independently for each quiz in IndexedDB. Leave for the library whenever you need to switch quizzes, then use **Resume Quiz** to continue or **Restart Quiz** to begin again (restarting an unfinished attempt asks for confirmation). When the first round is complete, the app saves and shows its score and percentage before offering **Review Mistakes**. Missed questions repeat in review rounds until each is answered correctly; the first-round score stays separate from review counts. The final screen shows the first-round score and total answers across all rounds, and completed scores remain in local history.

## Import questions

Choose **Import questions**, enter a quiz name, select a subject, and paste text or choose a PDF/DOCX file. The app extracts file text in your browser using PDF.js and Mammoth; source files are not uploaded. These libraries are loaded from cdnjs when their format is used, so an internet connection is needed for the first import in a session.

For best results, number each question and put each answer choice on its own line. For example:

```text
1. What is 2 + 2?
A) 3
B) 4
C) 5
D) 6
Answer: B
```

Correct answers can also be provided in a final `Answer Key:` section (for example, `1. B`). Every import shows an editable preview before saving. Missing or unclear answer keys are left blank and flagged for review; scanned PDFs without selectable text are not OCR-processed.

## Planned features

- Edit saved questions after import.
- Continue polishing accessibility and import edge-case handling.

The app runs without a backend, paid AI API, or account registration.
