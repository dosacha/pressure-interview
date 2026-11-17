import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { App } from '@/components/app';

const root = document.getElementById('root');
if (root === null) throw new Error('root element is missing');
createRoot(root).render(<App />);
