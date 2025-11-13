import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);


// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiY29jb3h1MTgiLCJhIjoiY21od3ptczUzMDU3MDJqcHNqbTJkZ3NtNSJ9.aTUSUQiHrPv7AX6txxL4-A';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// === Step 5 helpers & globals ===
let timeFilter = -1; // -1 means "any time"

// Format minutes since midnight → "1:30 PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Minutes since midnight from a Date object
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Filter trips by timeFilter (±60 minutes window)
function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;

  return trips.filter(trip => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

// Compute arrivals/departures/totalTraffic for each station
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    v => v.length,
    d => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(station => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// existing getCoords, but FIXED to use Long/Lat:
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}



map.on('load', async () => {
  // STEP 2 – bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  // === Step 3.1 – load stations JSON ===
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  let stations = jsonData.data.stations;
  console.log('Stations Array:', stations);

  const svg = d3.select('#map').select('svg');
  const mapEl = document.getElementById('map');

  // === Step 5 – load trips with Date parsing ===
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    }
  );

  // compute initial traffic (no filter)
  stations = computeStationTraffic(stations, trips);

  // radius scale (we’ll reuse this)
    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, d => d.totalTraffic)])
        .range([2, 40]);

    const stationFlow = d3
        .scaleQuantize()
        .domain([0, 1])
        .range([0, 0.5, 1]);

  // === create circles ===
    const circles = svg
        .selectAll('circle')
        .data(stations, d => d.short_name)
        .enter()
        .append('circle')
        .attr('r', d => radiusScale(d.totalTraffic))
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8)
        .style('--departure-ratio', d => {
        const ratio =
            d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5;
        return stationFlow(ratio);
        })
        .each(function (d) {
        d3.select(this)
            .append('title')
            .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
            );
        });


  // keep circles in right place
  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // === Step 5.2 – slider elements ===
  const timeSlider = document.getElementById('time-slider');     // NO '#'
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // update circles’ radii when filter changes
  function updateScatterPlot(currentFilter) {
    const filteredTrips = filterTripsByTime(trips, currentFilter);
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    circles
      .data(filteredStations, d => d.short_name)
      .attr('r', d => radiusScale(d.totalTraffic))
      .style('--departure-ratio', d => {
        const ratio =
          d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5;
        return stationFlow(ratio);
      });
  }

  // update text + call updateScatterPlot
  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  // listen to slider input
  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay(); // set initial display

  // Add a tooltip reference
const tooltip = d3.select("#tooltip");

// Add hover interactions
circles
  .on("mouseover", function (event, d) {
    tooltip.style("display", "block")
      .html(`
        <strong>${d.name}</strong><br>
        Arrivals: ${d.arrivals}<br>
        Departures: ${d.departures}<br>
        Total: ${d.totalTraffic}
      `);
  })
  .on("mousemove", function (event, d) {
  const { cx, cy } = getCoords(d);
  const rect = mapEl.getBoundingClientRect();

  tooltip
    .style("left", rect.left + window.scrollX + cx + 20 + "px") // 20px to the right
    .style("top",  rect.top  + window.scrollY + cy + "px");     // aligned vertically
})
  .on("mouseout", function () {
    tooltip.style("display", "none");
  });

});




