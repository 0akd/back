// src/aboutme/habity.ts
import { Hono } from 'hono';

const habity = new Hono();

const HABITIFY_BASE = 'https://api.habitify.me/v2';
const API_KEY = "hb_VvN36DwbWIL7fcdZ3hqgOdvXt8WMO7Es"; 

async function fetchHabitify(endpoint: string) {
  const res = await fetch(`${HABITIFY_BASE}${endpoint}`, {
    headers: {
      'X-API-Key': API_KEY,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Habitify API error: ${res.status}`);
  }
  return res.json();
}

habity.get('/habits', async (c) => {
  try {
    const dateParam = c.req.query('date');
    
    // 1. Fetch base habits to get the IDs, Names, and Icons
    const habitsRes = await fetchHabitify('/habits');
    const habitsList = habitsRes.data || [];

    // 2. Fetch the journal for the specific date to get Completed/Pending status
    let journalList: any[] = [];
    if (dateParam) {
      try {
        const journalRes = await fetchHabitify(`/habits/journal?date=${dateParam}`);
        journalList = journalRes.data || [];
      } catch (e) {
        console.error("Journal fetch failed", e);
      }
    }

    // 3. Fetch Statistics for EACH habit concurrently (this is where streaks live!)
    const mergedData = await Promise.all(habitsList.map(async (habit: any) => {
      
      // Match the journal entry to see if it was done today
      const journalEntry = journalList.find((j: any) => 
        j.habitId === habit.id || j.id === habit.id || (j.habit && j.habit.id === habit.id)
      );

      // Fetch the actual streak statistics for this specific habit
      let stats: any = {};
      try {
        const statsRes = await fetchHabitify(`/habits/${habit.id}/statistics`);
        stats = statsRes.data || {};
      } catch (e) {
        console.error(`Stats fetch failed for ${habit.id}`, e);
      }

      return {
        ...habit,
        ...journalEntry,
        // Explicitly map the streak data from the Statistics endpoint
        current_streak: stats.currentStreak || stats.current_streak || 0,
        best_streak: stats.longestStreak || stats.longest_streak || 0,
        completion_rate: journalEntry?.progress?.completionRate || journalEntry?.completion_rate || 0,
        status: journalEntry?.status || 'pending',
      };
    }));

    return c.json({ success: true, data: mergedData });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

export { habity };