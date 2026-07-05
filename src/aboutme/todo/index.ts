// src/aboutme/todo/index.ts
import { Hono } from 'hono';
import { Bindings } from './types';
import { summaryRouter } from './summary';
import { itemsRouter } from './items';
import { stepsRouter } from './steps';
import { categoriesRouter } from './categories';
import { copyRouter } from './copy';
import { statsRouter } from './stats'; // ← Import the new router

const todo = new Hono<{ Bindings: Bindings }>();

// Mount all domains to the base path
todo.route('/', summaryRouter);
todo.route('/', itemsRouter);
todo.route('/', stepsRouter);
todo.route('/', categoriesRouter);
todo.route('/', copyRouter);
todo.route('/', statsRouter); // ← Mount the stats router

// Export 'todo' so src/index.ts picks it up automatically!
export { todo };