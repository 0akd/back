-- Add current_page column to store the last read page
ALTER TABLE books 
ADD COLUMN current_page INTEGER DEFAULT 1;