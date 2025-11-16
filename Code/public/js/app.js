// public/js/app.js
const socket = io();

// UI refs
const regionsEl = document.getElementById('regions');
const plantsEl = document.getElementById('plants');
const alertsEl = document.getElementById('alerts');
const nodeCount = document.getElementById('nodeCount');
const alertCount = document.getElementById('alertCount');
const avgPur = document.getElementById('avgPur');
const totalWaterEl = document.getElementById('totalWater');
const avgPollEl = document.getElementById('avgPoll');
const purProgEl = document.getElementById('purProg');
const purRegionSel = document.getElementById('purRegion');
const purBtn = document.getElementById('purBtn');

let map;
let markers = {};
let currentRegions = [];
let waterChart, pollChart;
let pollutionTrendChart = null;    // new chart for AQI trend
let clickMarker = null;            // marker placed when user clicks map

/* ----------------------- existing core functions ----------------------- */

function initMap(){
  map = L.map('map', { zoomControl:true })
          .setView([20.5937, 78.9629], 5);  // India centered

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
      attribution:''
  }).addTo(map);
}


// helper color from pollution
function pollutionToColor(p){
  const pct = Math.min(1, Math.max(0, (p-10)/100));
  const r = Math.round(255 * pct);
  const g = Math.round(200 * (1-pct));
  return `rgb(${r},${g},60)`;
}

function popupHtml(r){
  return `<strong>${r.name}</strong><br/>Water: ${r.waterML} ML<br/>Pollution: ${r.pollution} PPM<br/>pH: ${r.ph}<br/>Purification: ${r.purification}%`;
}

function renderRegionsList(regions){
  regionsEl.innerHTML = '';
  purRegionSel.innerHTML = '<option value=\"\">Select region</option>';
  regions.forEach(r=>{
    const div = document.createElement('div');
    div.className = 'region';
    div.innerHTML = `<div><strong>${r.name}</strong><div class='small subtitle'>${r.waterML} ML • ${r.pollution} PPM</div></div><div><button data-id="${r.id}">View</button></div>`;
    regionsEl.appendChild(div);
    // clicking "View" focuses region on map (if available)
    div.querySelector('button').addEventListener('click', ()=> {
      try { focusRegion(r.id); } catch(e){ console.warn('focusRegion not available', e); }
    });
    // select option
    const opt = document.createElement('option'); opt.value = r.id; opt.textContent = r.name;
    purRegionSel.appendChild(opt);
  });
  nodeCount.textContent = regions.length;
}

function renderPlants(regions){
  plantsEl.innerHTML = '';
  regions.forEach(r=>{
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div style='display:flex;justify-content:space-between;align-items:center'><div><strong>${r.name}</strong><div class='small subtitle'>Plant progress</div></div><div style='width:100px;text-align:right'>${r.purification}%</div></div><div class='progress' style='margin-top:6px'><i style='width:${r.purification}%;background:linear-gradient(90deg,var(--accent),var(--accent-2));'></i></div>`;
    plantsEl.appendChild(wrap);
  });
  avgPur.textContent = Math.round(regions.reduce((s,x)=>s+x.purification,0)/regions.length) + '%';
}

function renderAlerts(alerts){
  alertsEl.innerHTML = '';
  alerts.forEach(al=>{
    const el = document.createElement('div');
    el.className = 'alert ' + (al.level || 'info');
    el.innerHTML = `<strong>${al.title}</strong><div class='small'>${al.msg}</div><div class='small' style='margin-top:6px;color:var(--muted)'>${new Date(al.ts).toLocaleString()}</div>`;
    alertsEl.prepend(el);
  });
  alertCount.textContent = alerts.length;
}

// map markers update or create
function updateMapMarkers(regions){
  regions.forEach(r=>{
    if(!markers[r.id]){
      const circle = L.circle([r.lat, r.lon], { radius: 20000 + r.waterML*20, color: pollutionToColor(r.pollution), fillColor: pollutionToColor(r.pollution), fillOpacity:0.4 }).addTo(map);
      circle.bindPopup(popupHtml(r));
      circle.on('click', ()=> focusRegion(r.id));
      markers[r.id] = circle;
    } else {
      markers[r.id].setStyle({ color: pollutionToColor(r.pollution), fillColor: pollutionToColor(r.pollution), radius: 20000 + r.waterML*20 });
      markers[r.id].setPopupContent(popupHtml(r));
    }
  });
}

// focus region on map
function focusRegion(id){
  const r = currentRegions.find(x=>x.id===id); if(!r) return;
  try {
    map.setView([r.lat, r.lon], 6);
    if(markers[id]) markers[id].openPopup();
  } catch(e){ console.warn('Map not initialized for focusRegion', e); }
}

// charts
function initCharts(){
  const wctx = document.getElementById('waterChart').getContext('2d');
  const pctx = document.getElementById('pollChart').getContext('2d');
  waterChart = new Chart(wctx, { type:'line', data:{ labels:[], datasets:[{label:'Water ML', data:[], tension:0.3}]}, options:{scales:{y:{beginAtZero:true}}}});
  pollChart = new Chart(pctx, { type:'line', data:{ labels:[], datasets:[{label:'Pollution PPM', data:[], tension:0.3}]}, options:{scales:{y:{beginAtZero:true}}}});
}

function pushChartData(totalWater, avgPoll){
  const t = new Date().toLocaleTimeString();
  waterChart.data.labels.push(t); waterChart.data.datasets[0].data.push(totalWater);
  pollChart.data.labels.push(t); pollChart.data.datasets[0].data.push(avgPoll);
  if(waterChart.data.labels.length>20){
    waterChart.data.labels.shift(); waterChart.data.datasets.forEach(d=>d.data.shift());
    pollChart.data.labels.shift(); pollChart.data.datasets.forEach(d=>d.data.shift());
  }
  waterChart.update(); pollChart.update();
}

/* ----------------------- Socket & existing handlers ----------------------- */

// Socket events
socket.on('connect', ()=> console.log('connected to server via socket.io'));

socket.on('telemetry', (payload) => {
  // payload: { timestamp, regions, totalWater, avgPoll, avgPur, alerts }
  currentRegions = payload.regions;
  // UI updates
  totalWaterEl.textContent = payload.totalWater + ' ML';
  avgPollEl.textContent = payload.avgPoll + ' PPM';
  purProgEl.textContent = payload.avgPur + '%';
  renderRegionsList(currentRegions);
  renderPlants(currentRegions);
  renderAlerts(payload.alerts || []);
  updateMapMarkers(currentRegions);
  pushChartData(payload.totalWater, payload.avgPoll);

  // Optionally also push avgPoll to pollutionTrendChart (if initialized)
  if(pollutionTrendChart){
    updatePollTrend(payload.avgPoll);
  }
});

// handle action result
socket.on('actionResult', (res) => {
  if(res.ok){
    console.log('Action OK', res.region);
  } else {
    console.warn('Action failed', res);
  }
});

// Purify button uses REST POST to server or socket
purBtn.addEventListener('click', async ()=> {
  const regionId = purRegionSel.value;
  if(!regionId) return alert('Select a region first');
  // Use Socket command (also server has REST API)
  socket.emit('purify', { regionId, boost: 12 });
});

/* ----------------------- NEW: Live AQI + Pollution Trend features ----------------------- */

/**
 * Initialize Pollution Trend Chart (AQI)
 * Requires a <canvas id="pollTrendChart"></canvas> present in HTML
 */
function initPollutionTrendChart(){
  const el = document.getElementById('pollTrendChart');
  if(!el) return; // silently skip if canvas not present
  const ctx = el.getContext('2d');
  pollutionTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'AQI (proxy)',
        data: [],
        borderWidth: 2,
        tension: 0.3,
        fill: false
      }]
    },
    options: {
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { display: true } }
    }
  });
}

/**
 * Update pollution trend chart with a new AQI value
 */
function updatePollTrend(aqi){
  if(!pollutionTrendChart) return;
  const t = new Date().toLocaleTimeString();
  pollutionTrendChart.data.labels.push(t);
  pollutionTrendChart.data.datasets[0].data.push(aqi);
  if(pollutionTrendChart.data.labels.length > 20){
    pollutionTrendChart.data.labels.shift();
    pollutionTrendChart.data.datasets[0].data.shift();
  }
  pollutionTrendChart.update();
}

/**
 * Convert PM2.5 (µg/m3) to a simple AQI proxy using US EPA breakpoints (linear interpolation)
 * This is a lightweight proxy for demo purposes.
 */
function pm25ToAqi(pm){
  if(pm === null || pm === undefined || isNaN(pm)) return Math.round(Math.random()*50 + 50); // fallback
  const breaks = [
    {clow:0.0, chigh:12.0, ilow:0, ihigh:50},
    {clow:12.1, chigh:35.4, ilow:51, ihigh:100},
    {clow:35.5, chigh:55.4, ilow:101, ihigh:150},
    {clow:55.5, chigh:150.4, ilow:151, ihigh:200},
    {clow:150.5, chigh:250.4, ilow:201, ihigh:300},
    {clow:250.5, chigh:350.4, ilow:301, ihigh:400},
    {clow:350.5, chigh:500.4, ilow:401, ihigh:500}
  ];
  for(let b of breaks){
    if(pm >= b.clow && pm <= b.chigh){
      const a = ((b.ihigh - b.ilow)/(b.chigh - b.clow))*(pm - b.clow) + b.ilow;
      return Math.round(a);
    }
  }
  return Math.round(pm); // fallback
}

/**
 * Fetch latest pollution measurement near coordinates using OpenAQ.
 * Returns object: { pm25: <value|null>, aqi: <computed proxy>, raw: <response> }
 */
async function fetchAqiAt(lat, lon){
  try{
    const url = `https://api.openaq.org/v2/latest?coordinates=${lat},${lon}&radius=50000&limit=5`;
    const res = await fetch(url);
    const data = await res.json();
    // try to find pm25 measurement
    if(data && data.results && data.results.length > 0){
      for(const r of data.results){
        if(r.measurements && r.measurements.length > 0){
          // find pm25 if available
          const m = r.measurements.find(x => x.parameter === 'pm25' || x.parameter === 'pm2.5');
          if(m && m.value !== undefined){
            const pm25 = Number(m.value);
            return { pm25, aqi: pm25ToAqi(pm25), raw: data };
          }
        }
      }
      // fallback: pick first measurement value (not pm25)
      const first = data.results[0];
      if(first.measurements && first.measurements.length > 0){
        const pm = Number(first.measurements[0].value);
        return { pm25: pm, aqi: pm25ToAqi(pm), raw: data };
      }
    }
    // no useful data
    return { pm25: null, aqi: null, raw: data };
  } catch(e){
    console.warn('OpenAQ fetch error', e);
    return { pm25: null, aqi: null, raw: null };
  }
}

/**
 * Reverse geocode to get place name (Nominatim)
 */
async function getLocationDetails(lat, lon){
  try{
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
    const res = await fetch(url);
    const data = await res.json();
    return data;
  } catch(e){
    console.warn('Nominatim error', e);
    return null;
  }
}

/**
 * Mock water availability (since no global free water API). Returns percentage and label.
 * If you later have a specific water API, replace this function.
 */
function getMockWaterAvailability(){
  const pct = Math.floor(Math.random() * 81) + 10; // 10%..90%
  let label = 'Moderate';
  if(pct < 25) label = 'Very Low';
  else if(pct < 45) label = 'Low';
  else if(pct < 70) label = 'Moderate';
  else if(pct < 85) label = 'High';
  else label = 'Very High';
  return {pct, label};
}

/* ----------------------- Integrate click-to-fetch into existing map ----------------------- */

/**
 * Make sure to call initPollutionTrendChart AFTER DOM has pollTrendChart canvas ready.
 * We'll add click handling on the SAME map instance used by your telemetry features.
 */
function attachMapClickHandler(){
  if(!map) return;
  map.on('click', async function(e){
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    // move / create click marker
    if(clickMarker) map.removeLayer(clickMarker);
    clickMarker = L.marker([lat, lon]).addTo(map);

    // reverse-geocode for place name (optional)
    const placeData = await getLocationDetails(lat, lon);
    let placeName = "Unknown Location";
    if(placeData && placeData.address){
      placeName = placeData.address.city || placeData.address.town || placeData.address.village || placeData.address.state || placeData.address.country || placeName;
    }

    // fetch AQI/PM2.5 from OpenAQ
    const aq = await fetchAqiAt(lat, lon);
    // fetch mock water availability
    const water = getMockWaterAvailability();

    // update marker popup
    const popup = `
      <strong>📍 ${placeName}</strong><br>
      💧 Water Availability: ${water.label} (${water.pct}%)<br>
      🌫️ PM2.5: ${aq.pm25 !== null ? aq.pm25+' µg/m³' : 'N/A'}<br>
      🔰 AQI (proxy): ${aq.aqi !== null ? aq.aqi : 'N/A'}
    `;
    clickMarker.bindPopup(popup).openPopup();

    // update top-level UI
    totalWaterEl.textContent = `${water.pct}% (${water.label})`;
    avgPollEl.textContent = aq.aqi !== null ? `${aq.aqi} (proxy)` : 'N/A';
    purProgEl.textContent = purProgEl.textContent; // keep unchanged (no change)

    // log a clear alert for very bad AQI
    if(aq.aqi !== null && aq.aqi >= 151){
      // add urgent alert card
      alertsEl.prepend(`<div class="alert crit"><strong>High pollution at ${placeName}</strong><div class="small">AQI (proxy) ${aq.aqi} — take protective measures</div><div class="small" style="margin-top:6px;color:var(--muted)">${new Date().toLocaleString()}</div></div>`);
    }

    // update pollution trend chart
    if(aq.aqi !== null){
      updatePollTrend(aq.aqi);
    } else {
      // if no data push a moderate random reading to trend so chart stays alive
      updatePollTrend(Math.round(Math.random()*60 + 40));
    }
  });
}

/* ----------------------- Initialization (call these on load) ----------------------- */

// init original features
initMap();
initCharts();
// init new pollution trend chart (only if canvas exists)
initPollutionTrendChart();
// attach click handler for live data
attachMapClickHandler();

