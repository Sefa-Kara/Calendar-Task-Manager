/**
 * CALENDAR TASK MANAGEMENT SYSTEM
 * Requires: Google Calendar Advanced Service (Calendar API v3)
 */

const CALENDAR_ID = 'primary';

// --- WEB APP SETUP ---

function doGet() {
    return HtmlService.createHtmlOutputFromFile('Index')
        .setTitle('Task Control Center')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// --- CORE API FOR FRONTEND ---

function getSystemState() {
    const props = PropertiesService.getUserProperties();
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const settings = {
        workStart: parseInt(props.getProperty('WORK_START') || '10', 10),
        workEnd: parseInt(props.getProperty('WORK_END') || '20', 10),
        gapMins: parseInt(props.getProperty('GAP_MINS') || '30', 10)
    };

    const response = Calendar.Events.list(CALENDAR_ID, {
        timeMin: now.toISOString(),
        timeMax: nextWeek.toISOString(),
        privateExtendedProperty: 'isTask=true',
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 10
    });

    const events = response.items || [];
    if (events.length === 0) return { status: 'no_tasks', settings: settings };

    const targetEvent = events[0];
    const startTime = new Date(targetEvent.start.dateTime || targetEvent.start.date);
    const endTime = new Date(targetEvent.end.dateTime || targetEvent.end.date);

    const activeEventId = props.getProperty('ACTIVE_TASK_ID');
    const actualStartStr = props.getProperty('ACTIVE_TASK_START');

    let delayMinutes = 0;
    let isStarted = false;

    if (activeEventId === targetEvent.id && actualStartStr) {
        isStarted = true;
        const actualStart = new Date(actualStartStr);
        delayMinutes = Math.floor((actualStart.getTime() - startTime.getTime()) / 60000);
    } else {
        delayMinutes = Math.floor((now.getTime() - startTime.getTime()) / 60000);
    }

    return {
        status: 'task_found',
        settings: settings,
        event: {
            id: targetEvent.id,
            summary: targetEvent.summary,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString()
        },
        isStarted: isStarted,
        delayMinutes: delayMinutes > 0 ? delayMinutes : 0
    };
}

function saveSettings(settings) {
    const props = PropertiesService.getUserProperties();
    props.setProperty('WORK_START', settings.workStart.toString());
    props.setProperty('WORK_END', settings.workEnd.toString());
    props.setProperty('GAP_MINS', settings.gapMins.toString());
    return getSystemState();
}

function handleAction(action, data) {
    const props = PropertiesService.getUserProperties();
    const eventId = data.eventId;

    const settings = {
        workStart: parseInt(props.getProperty('WORK_START') || '10', 10),
        workEnd: parseInt(props.getProperty('WORK_END') || '20', 10),
        gapMins: parseInt(props.getProperty('GAP_MINS') || '30', 10)
    };

    if (!eventId) return;

    switch (action) {
        case 'delete':
            Calendar.Events.remove(CALENDAR_ID, eventId);
            props.deleteProperty('ACTIVE_TASK_ID');
            props.deleteProperty('ACTIVE_TASK_START');
            break;

        case 'start':
            props.setProperty('ACTIVE_TASK_ID', eventId);
            props.setProperty('ACTIVE_TASK_START', new Date().toISOString());
            break;

        case 'add_time':
            extendEventAndShift(eventId, data.addMinutes, settings);
            break;

        case 'reschedule_next':
            rescheduleToNext(eventId, settings);
            break;

        case 'finish_reschedule':
            finishAndReschedule(eventId, settings);
            props.deleteProperty('ACTIVE_TASK_ID');
            props.deleteProperty('ACTIVE_TASK_START');
            break;

        case 'finish_nothing':
            props.deleteProperty('ACTIVE_TASK_ID');
            props.deleteProperty('ACTIVE_TASK_START');
            break;
    }
    return getSystemState();
}

// --- SHIFTING & SCHEDULING LOGIC ---

function getEventChain(targetOrigStart) {
    const queryStart = new Date(new Date(targetOrigStart).getTime() - 60 * 60000);
    const maxLookahead = new Date(queryStart.getTime() + 14 * 24 * 60 * 60 * 1000);

    return Calendar.Events.list(CALENDAR_ID, {
        timeMin: queryStart.toISOString(),
        timeMax: maxLookahead.toISOString(),
        privateExtendedProperty: 'isTask=true',
        singleEvents: true,
        orderBy: 'startTime'
    }).items || [];
}

function extendEventAndShift(eventId, additionalMinutes, settings) {
    const targetEv = Calendar.Events.get(CALENDAR_ID, eventId);
    const events = getEventChain(targetEv.start.dateTime);

    const targetIndex = events.findIndex(e => e.id === eventId);
    if (targetIndex === -1) return;

    // Snapshot original times before mutating
    const origStart = new Date(events[targetIndex].start.dateTime);
    const origEnd = new Date(events[targetIndex].end.dateTime);

    let newEnd = new Date(origEnd.getTime() + additionalMinutes * 60000);
    events[targetIndex].end.dateTime = newEnd.toISOString();
    Calendar.Events.patch(events[targetIndex], CALENDAR_ID, eventId);

    chainShift(events, targetIndex, newEnd, settings, false, origStart, origEnd);
}

function finishAndReschedule(eventId, settings) {
    const targetEv = Calendar.Events.get(CALENDAR_ID, eventId);
    const events = getEventChain(targetEv.start.dateTime);

    const targetIndex = events.findIndex(e => e.id === eventId);
    if (targetIndex === -1) return;

    // Snapshot original times before mutating
    const origStart = new Date(events[targetIndex].start.dateTime);
    const origEnd = new Date(events[targetIndex].end.dateTime);

    const now = new Date();
    events[targetIndex].end.dateTime = now.toISOString();
    Calendar.Events.patch(events[targetIndex], CALENDAR_ID, eventId);

    chainShift(events, targetIndex, now, settings, true, origStart, origEnd);
}

function rescheduleToNext(eventId, settings) {
    const targetEv = Calendar.Events.get(CALENDAR_ID, eventId);
    const events = getEventChain(targetEv.start.dateTime);

    const targetIndex = events.findIndex(e => e.id === eventId);
    if (targetIndex === -1) return;

    // Snapshot original times before mutating
    const origStart = new Date(events[targetIndex].start.dateTime);
    const origEnd = new Date(events[targetIndex].end.dateTime);

    const durationMs = origEnd.getTime() - origStart.getTime();

    let newStart;
    if (targetIndex + 1 < events.length) {
        newStart = new Date(events[targetIndex + 1].start.dateTime);
    } else {
        newStart = new Date(origStart.getTime() + durationMs + (settings.gapMins * 60000));
    }

    let newEnd = new Date(newStart.getTime() + durationMs);

    events[targetIndex].start.dateTime = newStart.toISOString();
    events[targetIndex].end.dateTime = newEnd.toISOString();
    Calendar.Events.patch(events[targetIndex], CALENDAR_ID, eventId);

    chainShift(events, targetIndex, newEnd, settings, false, origStart, origEnd);
}

/**
 * Universal Ripple Engine
 * @param {Array} events - Complete chain of future tasks
 * @param {Number} startIndex - The index of the task that was just manipulated
 * @param {Date} currentBoundary - The exact time the manipulated task finished
 * @param {Object} settings - Work hours and gap parameters
 * @param {Boolean} forcePullBackward - Allow tasks to slide into earlier times 
 * @param {Date} origTargetStart - True original start time of the manipulated task
 * @param {Date} origTargetEnd - True original end time of the manipulated task
 */
function chainShift(events, startIndex, currentBoundary, settings, forcePullBackward, origTargetStart, origTargetEnd) {
    // Prime the loop with the TRUE original times of the first event, 
    // ensuring the next task doesn't falsely think they were originally on the same day.
    let prevOriginalStart = origTargetStart;
    let prevOriginalEnd = origTargetEnd;

    for (let i = startIndex + 1; i < events.length; i++) {
        const ev = events[i];
        if (!ev.start.dateTime) continue;

        const origStart = new Date(ev.start.dateTime);
        const origEnd = new Date(ev.end.dateTime);
        const durationMs = origEnd.getTime() - origStart.getTime();

        // 1. Calculate space between tasks based on their ORIGINAL relationship
        let gapMs = 0;
        const sameDay = origStart.getDate() === prevOriginalStart.getDate() && origStart.getMonth() === prevOriginalStart.getMonth();

        if (!sameDay) {
            // Different days originally -> enforce user-defined minimum gap when pushing into them
            gapMs = settings.gapMins * 60000;
        } else {
            // Same day originally -> strictly lock their original visual space
            gapMs = origStart.getTime() - prevOriginalEnd.getTime();
            if (gapMs < 0) gapMs = 0;
        }

        let proposedStart = new Date(currentBoundary.getTime() + gapMs);

        // 2. Prevent arbitrary backward pulling unless explicitly requested
        if (!forcePullBackward && proposedStart.getTime() < origStart.getTime()) {
            proposedStart = new Date(origStart.getTime());
        }

        let proposedEnd = new Date(proposedStart.getTime() + durationMs);

        // 3. Apply Working Hours constraint
        if (proposedStart.getHours() < settings.workStart) {
            proposedStart.setHours(settings.workStart, 0, 0, 0);
            proposedEnd = new Date(proposedStart.getTime() + durationMs);
        }

        const endHourFloat = proposedEnd.getHours() + (proposedEnd.getMinutes() / 60);
        if (endHourFloat > settings.workEnd) {
            proposedStart.setDate(proposedStart.getDate() + 1);
            proposedStart.setHours(settings.workStart, 0, 0, 0);
            proposedEnd = new Date(proposedStart.getTime() + durationMs);
        }

        // 4. Update the event if it shifted
        if (origStart.getTime() !== proposedStart.getTime() || origEnd.getTime() !== proposedEnd.getTime()) {
            ev.start.dateTime = proposedStart.toISOString();
            ev.end.dateTime = proposedEnd.toISOString();
            Calendar.Events.patch(ev, CALENDAR_ID, ev.id);
        }

        // 5. Update chain links for next task
        currentBoundary = proposedEnd;
        prevOriginalStart = origStart;
        prevOriginalEnd = origEnd;
    }
}