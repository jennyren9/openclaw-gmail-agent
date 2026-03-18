#!/usr/bin/env node
/**
 * Helper script to update digest schedule (for future scheduler setup)
 */

import cron from "node-cron";

interface ScheduleTask {
  name: string;
  schedule: string;
  fn: () => Promise<void>;
}

const tasks: ScheduleTask[] = [];

/**
 * Add a scheduled task
 */
export function addTask(
  name: string,
  schedule: string,
  fn: () => Promise<void>
): ScheduleTask {
  console.log(`[SCHEDULER] Registered task: ${name}`);
  console.log(`[SCHEDULER] Schedule: ${schedule}`);

  const task: ScheduleTask = { name, schedule, fn };
  tasks.push(task);

  return task;
}

/**
 * Start the scheduler
 */
export function startScheduler(): void {
  console.log(`[SCHEDULER] Starting with ${tasks.length} task(s)\n`);

  for (const task of tasks) {
    cron.schedule(task.schedule, async () => {
      try {
        console.log(`[SCHEDULER] Running task: ${task.name}`);
        await task.fn();
        console.log(`[SCHEDULER] Task completed: ${task.name}\n`);
      } catch (err) {
        console.error(`[SCHEDULER] Task failed: ${task.name}`, err);
      }
    });
  }

  console.log("[SCHEDULER] Scheduler running. Press Ctrl+C to stop.\n");
}

/**
 * Stop all tasks
 */
export function stopScheduler(): void {
  cron.getTasks().forEach((task) => {
    task.stop();
  });
}
