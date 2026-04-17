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
  
  const pastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  
  const settings = {
    workStart: parseInt(props.getProperty('WORK_START') || '10', 10),
    workEnd: parseInt(props.getProperty('WORK_END') || '20', 10),
    gapMins: parseInt(props.getProperty('GAP_MINS') || '30', 10)
  };

  const response = Calendar.Events.list(CALENDAR_ID, {
    timeMin: pastWeek.toISOString(),
    timeMax: nextWeek.toISOString(),
    privateExtendedProperty: 'isTask=true',
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100 
  });

  const events = (response.items || []).filter(e => {
    const isCompleted = e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.taskStatus === 'completed';
    return !isCompleted;
  });

  if (events.length === 0) return { status: 'no_tasks', settings: settings };

  const targetEvent = events[0];
  const startTime = new Date(targetEvent.start.dateTime || targetEvent.start.date);
  const endTime = new Date(targetEvent.end.dateTime || targetEvent.end.date);
  
  const activeEventId = props.getProperty('ACTIVE_TASK_ID');
  const actualStartStr = props.getProperty('ACTIVE_TASK_START');

  const isShiftable = !(targetEvent.extendedProperties && targetEvent.extendedProperties.private && targetEvent.extendedProperties.private.isShiftable === 'false');

  if (activeEventId !== targetEvent.id && now.getTime() > endTime.getTime() && isShiftable) {
    rescheduleToNext(targetEvent.id, settings);
    return getSystemState(); 
  }

  let delayMinutes = 0;
  let isStarted = false;
  
  if (activeEventId === targetEvent.id && actualStartStr) {
    isStarted = true;
    const actualStart = new Date(actualStartStr);
    delayMinutes = Math.floor((actualStart.getTime() - startTime.getTime()) / 60000);
  } else {
    delayMinutes = Math.floor((now.getTime() - startTime.getTime()) / 60000);
  }

  const timeAdded = props.getProperty('TIME_ADDED_' + targetEvent.id) === 'true';

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
    delayMinutes: delayMinutes > 0 ? delayMinutes : 0,
    timeAdded: timeAdded
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
      props.deleteProperty('TIME_ADDED_' + eventId);
      break;

    case 'start':
      props.setProperty('ACTIVE_TASK_ID', eventId);
      props.setProperty('ACTIVE_TASK_START', new Date().toISOString());
      break;

    case 'add_time':
      props.setProperty('TIME_ADDED_' + eventId, 'true'); 
      extendEventAndShift(eventId, data.addMinutes, settings);
      break;

    case 'reschedule_next':
      rescheduleToNext(eventId, settings);
      break;

    case 'finish_reschedule':
      finishAndReschedule(eventId, settings);
      props.deleteProperty('ACTIVE_TASK_ID');
      props.deleteProperty('ACTIVE_TASK_START');
      props.deleteProperty('TIME_ADDED_' + eventId);
      break;

    case 'finish_nothing':
      finishAndDoNothing(eventId);
      props.deleteProperty('ACTIVE_TASK_ID');
      props.deleteProperty('ACTIVE_TASK_START');
      props.deleteProperty('TIME_ADDED_' + eventId);
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
    orderBy: 'startTime',
    maxResults: 150
  }).items || [];
}

function extendEventAndShift(eventId, additionalMinutes, settings) {
  const targetEv = Calendar.Events.get(CALENDAR_ID, eventId);
  const events = getEventChain(targetEv.start.dateTime);
  
  const targetIndex = events.findIndex(e => e.id === eventId);
  if (targetIndex === -1) return;

  const origStart = new Date(events[targetIndex].start.dateTime);
  const origEnd = new Date(events[targetIndex].end.dateTime);

  let newEnd = new Date(origEnd.getTime() + additionalMinutes * 60000);
  events[targetIndex].end.dateTime = newEnd.toISOString();
  Calendar.Events.patch(events[targetIndex], CALENDAR_ID, eventId);

  chainShift(events, targetIndex, newEnd, settings, false, origStart, origEnd);
}

function finishAndDoNothing(eventId) {
  const ev = Calendar.Events.get(CALENDAR_ID, eventId);
  ev.end.dateTime = new Date().toISOString();
  
  if (!ev.extendedProperties) ev.extendedProperties = { private: {} };
  ev.extendedProperties.private.taskStatus = 'completed';
  ev.extendedProperties.private.isShiftable = 'false'; 
  
  Calendar.Events.patch(ev, CALENDAR_ID, eventId);
}

function finishAndReschedule(eventId, settings) {
  const targetEv = Calendar.Events.get(CALENDAR_ID, eventId);
  const events = getEventChain(targetEv.start.dateTime);
  
  const targetIndex = events.findIndex(e => e.id === eventId);
  if (targetIndex === -1) return;

  const origStart = new Date(events[targetIndex].start.dateTime);
  const origEnd = new Date(events[targetIndex].end.dateTime);

  const now = new Date();
  events[targetIndex].end.dateTime = now.toISOString();
  
  if (!events[targetIndex].extendedProperties) events[targetIndex].extendedProperties = { private: {} };
  events[targetIndex].extendedProperties.private.taskStatus = 'completed';
  events[targetIndex].extendedProperties.private.isShiftable = 'false'; 
  
  Calendar.Events.patch(events[targetIndex], CALENDAR_ID, eventId);

  chainShift(events, targetIndex, now, settings, true, origStart, origEnd);
}

function rescheduleToNext(eventId, settings) {
  const targetEv = Calendar.Events.get(CALENDAR_ID, eventId);
  const events = getEventChain(targetEv.start.dateTime);
  
  const targetIndex = events.findIndex(e => e.id === eventId);
  if (targetIndex === -1) return;

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

function chainShift(events, startIndex, currentBoundary, settings, forcePullBackward, origTargetStart, origTargetEnd) {
  let prevOriginalStart = origTargetStart; 
  let prevOriginalEnd = origTargetEnd;

  // 1. Map out all immovable blocks (walls) to prevent collisions
  const unshiftableBlocks = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.isShiftable === 'false') {
      if (ev.start.dateTime) {
        unshiftableBlocks.push({
          start: new Date(ev.start.dateTime),
          end: new Date(ev.end.dateTime)
        });
      }
    }
  }

  for (let i = startIndex + 1; i < events.length; i++) {
    const ev = events[i];
    if (!ev.start.dateTime) continue;

    const origStart = new Date(ev.start.dateTime);
    const origEnd = new Date(ev.end.dateTime);
    const durationMs = origEnd.getTime() - origStart.getTime();

    // Skip unshiftable tasks, but update the boundary
    if (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.isShiftable === 'false') {
      currentBoundary = origEnd;
      prevOriginalStart = origStart;
      prevOriginalEnd = origEnd;
      continue;
    }

    let gapMs = 0;
    const sameDay = origStart.getDate() === prevOriginalStart.getDate() && origStart.getMonth() === prevOriginalStart.getMonth();
    
    if (!sameDay) {
      gapMs = settings.gapMins * 60000;
    } else {
      gapMs = origStart.getTime() - prevOriginalEnd.getTime();
      if (gapMs < 0) gapMs = 0;
    }

    let proposedStart = new Date(currentBoundary.getTime() + gapMs);

    if (!forcePullBackward && proposedStart.getTime() < origStart.getTime()) {
       proposedStart = new Date(origStart.getTime());
    }

    let proposedEnd = new Date(proposedStart.getTime() + durationMs);

    // 2. Smart Resolution Engine: Bounce between Working Hours and Immovable Walls
    let resolvingCollisions = true;
    let safetyCounter = 0;

    while (resolvingCollisions && safetyCounter < 50) {
      resolvingCollisions = false;
      safetyCounter++;

      // Check Working Hours
      if (proposedStart.getHours() < settings.workStart) {
        proposedStart.setHours(settings.workStart, 0, 0, 0);
        proposedEnd = new Date(proposedStart.getTime() + durationMs);
        resolvingCollisions = true;
        continue;
      }

      const endHourFloat = proposedEnd.getHours() + (proposedEnd.getMinutes() / 60);
      if (endHourFloat > settings.workEnd) {
        proposedStart.setDate(proposedStart.getDate() + 1);
        proposedStart.setHours(settings.workStart, 0, 0, 0);
        proposedEnd = new Date(proposedStart.getTime() + durationMs);
        resolvingCollisions = true;
        continue;
      }

      // Check Collisions with Immovable Blocks
      for (let block of unshiftableBlocks) {
        // If overlapping with a wall
        if (proposedStart.getTime() < block.end.getTime() && proposedEnd.getTime() > block.start.getTime()) {
          // Jump over the wall and add the default gap
          proposedStart = new Date(block.end.getTime() + (settings.gapMins * 60000));
          proposedEnd = new Date(proposedStart.getTime() + durationMs);
          resolvingCollisions = true; 
          break; 
        }
      }
    }

    // 3. Ripple Dissipation (Early Exit to save API limits)
    if (!forcePullBackward && proposedStart.getTime() === origStart.getTime() && proposedEnd.getTime() === origEnd.getTime()) {
       break; // The ripple has settled into an empty space. Stop updating future events.
    }

    if (origStart.getTime() !== proposedStart.getTime() || origEnd.getTime() !== proposedEnd.getTime()) {
      ev.start.dateTime = proposedStart.toISOString();
      ev.end.dateTime = proposedEnd.toISOString();
      Calendar.Events.patch(ev, CALENDAR_ID, ev.id);
    }

    currentBoundary = proposedEnd;
    prevOriginalStart = origStart; 
    prevOriginalEnd = origEnd;
  }
}