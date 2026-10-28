// Loaded first so every module sees .env values when it is imported.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
