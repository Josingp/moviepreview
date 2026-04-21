import fs from 'fs';

let code = fs.readFileSync('src/App.tsx', 'utf-8');

// Global Background & Text mappings
code = code.replace(/bg-zinc-950/g, 'bg-gray-50');
code = code.replace(/bg-zinc-900/g, 'bg-white');
code = code.replace(/border-zinc-800/g, 'border-gray-200');
code = code.replace(/border-zinc-700/g, 'border-gray-300');

// Text zinc mappings
code = code.replace(/text-zinc-600/g, 'text-gray-400');
code = code.replace(/text-zinc-500/g, 'text-gray-500');
code = code.replace(/text-zinc-400/g, 'text-gray-600');
code = code.replace(/text-zinc-300/g, 'text-gray-700');
code = code.replace(/text-zinc-200/g, 'text-gray-800');
code = code.replace(/text-zinc-100/g, 'text-gray-900');

// Input backgrounds
code = code.replace(/bg-zinc-800 focus:outline-none/g, 'bg-white border border-gray-300 shadow-sm focus:outline-none');

// bg-zinc-800 is used for secondary buttons/elements or empty seats
code = code.replace(/bg-zinc-800/g, 'bg-gray-100');
code = code.replace(/hover:bg-zinc-800/g, 'hover:bg-gray-100');
code = code.replace(/hover:bg-zinc-700/g, 'hover:bg-gray-200');

// The tricky part: text-white
// We will replace all text-white to text-gray-900
code = code.replace(/text-white/g, 'text-gray-900');

// Then, we selectively turn back things that should be text-white based on background:
const coloredBgs = [
  'bg-blue-600', 'bg-blue-500', 
  'bg-indigo-600', 'bg-indigo-500', 
  'bg-red-600', 'bg-red-500', 
  'bg-green-500', 'bg-gray-900'
];

// For elements with a colored background, we need to enforce text-white
let lines = code.split('\n');
for (let i=0; i<lines.length; i++) {
  let line = lines[i];
  if (coloredBgs.some(bg => line.includes(bg)) && line.includes('text-gray-900')) {
     line = line.replace(/text-gray-900/g, 'text-white');
  }
  lines[i] = line;
}
code = lines.join('\n');

// Admin View Mode Map Switcher logic
code = code.replace(/adminViewMode === 'map' \? "bg-gray-100 text-gray-900 shadow"/g, 'adminViewMode === \'map\' ? "bg-white border shadow-sm text-blue-600"');
code = code.replace(/adminViewMode === 'dashboard' \? "bg-indigo-600 text-white shadow"/g, 'adminViewMode === \'dashboard\' ? "bg-white border shadow-sm text-indigo-600"');

fs.writeFileSync('src/App.tsx', code);
console.log("Migration script complete");
