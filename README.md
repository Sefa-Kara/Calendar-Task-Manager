***

# Google Calendar Dynamic Task Scheduler 🗓️

A complete task management, tracking, and dynamic rescheduling system built directly on top of Google Calendar. 

This Web App acts as a floating "Control Center" for your daily schedule. Instead of manually dragging and dropping events when a task runs late or finishes early, this system uses a **Universal Chain Engine** to automatically ripple your future schedule forward or backward—perfectly preserving the gaps between events and strictly respecting your personal working hours.

> **⚠️ IMPORTANT DEPENDENCY:** > This system tracks events using hidden metadata (`isTask` and `isShiftable`). To get events into your Google Calendar with this specific metadata, you **must** use the companion tool: 
> 👉 **[Calendar ICS Importer](https://github.com/Sefa-Kara/Calendar-Ics-Importer)**

## 🌟 Features

- **Dynamic Chain Shifting:** When a task runs late, it doesn't just push the next task—it sequentially shifts your *entire* future schedule like train cars, maintaining original spacing.
- **Working Hours Constraint:** Configure your daily start and end times. The engine will never schedule a task while you sleep; overflow is automatically neatly pushed to the next working day.
- **Smart Gap Management:** If a task gets pushed to tomorrow, the system discards the massive "overnight" gap and gracefully applies a default 30-minute space (customizable) to keep your schedule tight.
- **Real-Time Dashboard UI:** A clean, auto-refreshing web interface that detects your current active task and provides quick-action buttons (Start, Add Time, Reschedule, Finish).
- **Auto-Shorten & Pull:** Finishing a task early? The "Finish + Reschedule" button shortens the current event and naturally pulls your upcoming tasks backward into the newly opened free time.

---

## 🛠️ Installation (Google Apps Script)

This system runs 100% free in your browser using Google Apps Script. No local servers or complex hosting required.

1. Go to [script.google.com](https://script.google.com/) and click **New Project**.
2. On the left sidebar, click the **+** next to **Services**, select **Google Calendar API** (v3), and click **Add**.
3. Replace the code in the default `Code.gs` file with the contents of `src/Code.js` from this repository.
4. Click the **+** next to **Files**, select **HTML**, name it exactly `Index`, and paste the contents of `src/Index.html`.
5. In the top right, click **Deploy > New deployment**.
6. Click the gear icon next to "Select type" and choose **Web app**.
7. Set **Execute as** to **User accessing the web app** *(Critical!)*.
8. Set **Who has access** to **Only myself**.
9. Click **Deploy**, authorize the Google Calendar permissions, and copy the **Web app URL**.

Save this URL as a bookmark on your computer or phone. This is your personal Task Control Center.

---

## 📝 How It Works

Once your events are imported (via the [ICS Importer](https://github.com/Sefa-Kara/Calendar-Ics-Importer)), open your Web App dashboard. 

### The Settings Panel
At the top of the UI, configure your rules:
- **Work Start:** The hour your day begins (e.g., `10` for 10:00 AM).
- **Work End:** The hour you stop working (e.g., `20` for 8:00 PM).
- **Gap (min):** The default space enforced between tasks when they are pushed to a new day.

### The Action Buttons
Based on the current time and your schedule, the dashboard will offer contextual buttons:
- **Start Task:** Locks in the exact real-world time you began the task.
- **Add +X Mins:** If you started late, or a task is dragging on, click this to extend the current event and automatically ripple all future events forward.
- **Reschedule (Move Next):** Skips the current task by moving it precisely to the start time of your *next* task, pushing everything else out of the way.
- **Finish Early/Late + Reschedule:** Marks the task as complete *right now*. If you finished early, it pulls future events backward. If late, it pushes them forward.

---

## 🔗 The Complete Workflow

To get the most out of this ecosystem, use both tools together:

1. **Plan:** Write your `.ics` file with `X-IS-TASK:true` and `X-IS-SHIFTABLE:true` tags.
2. **Import:** Run the [Calendar ICS Importer](https://github.com/Sefa-Kara/Calendar-Ics-Importer) to inject these events and metadata into your Google Calendar.
3. **Execute:** Keep this **Task Scheduler Web App** open during the day to start, delay, and finish tasks while the engine auto-manages your calendar in the background.

---

## 🤝 Contributing
Feel free to open issues or submit pull requests! Whether it's optimizing the shifting algorithm, adding new UI features, or fixing edge cases, contributions are highly appreciated.