import 'dotenv/config';

import { DataSource } from 'typeorm';

import { validateEnvironment } from '../config/environment';
import { createDataSourceOptions } from './database.options';

export default new DataSource(createDataSourceOptions(validateEnvironment(process.env)));
