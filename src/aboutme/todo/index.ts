// src/aboutme/todo/index.ts
import { Hono } from 'hono';
import { Bindings } from './types';
import { summaryRouter } from './summary';
import { itemsRouter } from './items';
import { stepsRouter } from './steps';
import { categoriesRouter } from './categories';
import { copyRouter } from './copy';

const todo = new Hono<{ Bindings: Bindings }>();

// Mount all domains to the base path
todo.route('/', summaryRouter);
todo.route('/', itemsRouter);
todo.route('/', stepsRouter);
todo.route('/', categoriesRouter);
todo.route('/', copyRouter);

// Export 'todo' so src/index.ts picks it up automatically!
export { todo };