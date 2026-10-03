const fs = require('fs');
const path = 'd:\\Project\\train valley 2\\train product\\src\\data\\tv2.json';
const raw = fs.readFileSync(path, 'utf-8');
console.log('File length:', raw.length);
console.log('First 100 chars:', raw.substring(0, 100));
console.log('Last 100 chars:', raw.substring(raw.length - 100));
try {
  const data = JSON.parse(raw);
  console.log('Instances:', data.instances.length);
  const hasEY = data.instances.some(i => i.id === '工人eY');
  console.log('Has 工人eY:', hasEY);
  const xd = data.instances.find(i => i.id === '工人XD');
  console.log('工人XD at index:', data.instances.indexOf(xd));
  if (xd) {
    const xdIdx = data.instances.indexOf(xd);
    const next = data.instances[xdIdx + 1];
    console.log('Next instance after 工人XD:', next?.id);
  }
} catch(e) {
  console.log('Parse error:', e.message);
}