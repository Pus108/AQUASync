// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static frontend
app.use(express.static('public'));
app.use(express.json());

// In-memory regions (initial values)
let regions = [
  { id:'R1', name:'Coastal Delta', lat:18.95, lon:72.8, waterML:520, pollution:48, ph:8.1, temp:22.4, purification:62 },
  { id:'R2', name:'River Basin North', lat:26.85, lon:80.9, waterML:420, pollution:62, ph:6.9, temp:20.1, purification:35 },
  { id:'R3', name:'Highland Lakes', lat:34.05, lon:-118.25, waterML:310, pollution:18, ph:7.2, temp:15.0, purification:81 },
  { id:'R4', name:'Urban Reservoir', lat:51.5, lon:-0.12, waterML:180, pollution:75, ph:6.4, temp:12.5, purification:28 },
  { id:'R5', name:'Wetland Belt', lat:-33.86, lon:151.2, waterML:260, pollution:30, ph:7.8, temp:17.6, purification:54 }
];

let alerts = [];

// Utility: random walk helper
function randomWalk(v, volatility=0.07, min=0, max=9999){
  const change = (Math.random()*2 -1) * v * volatility;
  let nv = v + change;
  if(nv < min) nv = min; if(nv>max) nv=max;
  return Math.round(nv*100)/100;
}

// Simulation tick on server every second
function simulateTick(){
  regions.forEach(s=>{
    s.waterML = randomWalk(s.waterML, 0.02, 10, 4000);
    s.pollution = randomWalk(s.pollution, 0.05, 5, 200);
    s.ph = Math.round((randomWalk(s.ph, 0.02, 5.2, 9.2))*100)/100;
    s.temp = randomWalk(s.temp, 0.03, -5, 45);

    // purification increases if pollution high (simulating plant action)
    if(s.pollution > 60 && Math.random() < 0.6){
      s.purification = Math.min(100, s.purification + Math.random()*4);
    } else {
      s.purification = Math.max(0, s.purification - Math.random()*1.2);
    }

    // threshold-triggered alerts
    if(s.waterML < 45 && !alerts.find(a=>a.id === s.id+'-short')){
      alerts.push({ id: s.id+'-short', level:'crit', title:`Critical shortage in ${s.name}`, msg:`Water ${s.waterML} ML — immediate response needed`, ts:Date.now() });
    }
    if(s.pollution > 85 && !alerts.find(a=>a.id === s.id+'-poll')){
      alerts.push({ id: s.id+'-poll', level:'warn', title:`High pollution at ${s.name}`, msg:`Pollution ${s.pollution} PPM — activate purification`, ts:Date.now() });
    }
  });

  // prune old alerts (6 hours)
  alerts = alerts.filter(a=> (Date.now() - a.ts) < 1000*60*60*6);

  // broadcast telemetry
  const aggregate = {
    timestamp: Date.now(),
    regions,
    totalWater: Math.round(regions.reduce((s,r)=>s + r.waterML,0)),
    avgPoll: Math.round(regions.reduce((s,r)=>s + r.pollution,0) / regions.length),
    avgPur: Math.round(regions.reduce((s,r)=>s + r.purification,0) / regions.length),
    alerts
  };

  io.emit('telemetry', aggregate);
}

// REST endpoints for frontend (and for controlling simulation)
app.get('/api/regions', (req,res)=> res.json(regions));
app.get('/api/alerts', (req,res)=> res.json(alerts));

// Trigger a purification boost for a region (simple control endpoint)
app.post('/api/regions/:id/purify', (req,res)=>{
  const { id } = req.params;
  const region = regions.find(r=>r.id === id);
  if(!region) return res.status(404).json({ error: 'Region not found' });
  // boost purification temporarily
  region.purification = Math.min(100, region.purification + (req.body.boost || 8));
  // reduce pollution as effect
  region.pollution = Math.max(0, region.pollution - (req.body.clean || 6));
  return res.json(region);
});

// Socket.IO connection handling (we don't need per-socket state here)
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  // on new connection send immediate telemetry snapshot
  socket.emit('telemetry', {
    timestamp: Date.now(),
    regions,
    totalWater: Math.round(regions.reduce((s,r)=>s + r.waterML,0)),
    avgPoll: Math.round(regions.reduce((s,r)=>s + r.pollution,0) / regions.length),
    avgPur: Math.round(regions.reduce((s,r)=>s + r.purification,0) / regions.length),
    alerts
  });

  socket.on('purify', (payload) => {
    const { regionId, boost } = payload || {};
    const region = regions.find(r=>r.id === regionId);
    if(region){
      region.purification = Math.min(100, region.purification + (boost || 10));
      region.pollution = Math.max(0, region.pollution - (boost||10) * 0.8);
      socket.emit('actionResult', { ok:true, region });
      // push update to all
      io.emit('telemetry', {
        timestamp: Date.now(),
        regions,
        totalWater: Math.round(regions.reduce((s,r)=>s + r.waterML,0)),
        avgPoll: Math.round(regions.reduce((s,r)=>s + r.pollution,0) / regions.length),
        avgPur: Math.round(regions.reduce((s,r)=>s + r.purification,0) / regions.length),
        alerts
      });
    } else {
      socket.emit('actionResult', { ok:false, error: 'region not found' });
    }
  });

  socket.on('disconnect', ()=> console.log('Client disconnected:', socket.id));
});

// Start simulation loop
setInterval(simulateTick, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`AquaSync server running on http://localhost:${PORT}`));
