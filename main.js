document.getElementById('configToggle').addEventListener('click', function () {
    const configSection = document.getElementById('configSection');
    const configIcon = document.getElementById('configIcon');

    if (configSection.classList.contains('hidden')) {
        configSection.classList.remove('hidden');
        configIcon.textContent = 'expand_less';
    } else {
        configSection.classList.add('hidden');
        configIcon.textContent = 'expand_more';
    }
});

const map = L.map('map').setView([46.603354, 1.888334], 6);

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
});

const wmtsLayer = L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    {
        attribution: '© IGN France',
        maxZoom: 20,
        className: 'wmts-layer'
    }
);

L.GridLayer.TileGrid = L.GridLayer.extend({
    createTile: function (coords) {
        const tile = document.createElement('canvas');
        const tileSize = this.getTileSize();
        tile.width = tileSize.x;
        tile.height = tileSize.y;

        const ctx = tile.getContext('2d');
        ctx.strokeStyle = '#f2f7f2ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, tileSize.x, tileSize.y);

        ctx.fillStyle = '#f7f9f7ff';
        ctx.font = 'bold 14px Arial';
        const text = `${coords.z}/${coords.x}/${coords.y}`;
        ctx.fillText(text, 10, 20);

        return tile;
    }
});

L.gridLayer.tileGrid = function (opts) {
    return new L.GridLayer.TileGrid(opts);
};

const tileGridLayer = L.gridLayer.tileGrid({
    pane: 'overlayPane',
    opacity: 0.8
});

osmLayer.addTo(map);
tileGridLayer.addTo(map);

const overlayLayers = {
    'OpenStreetMap': osmLayer,
    'IGN Orthophotos': wmtsLayer
};

L.control.layers(null, overlayLayers, { collapsed: false }).addTo(map);

L.Control.geocoder({
    defaultMarkGeocode: false
})
    .on('markgeocode', function (e) {
        const bbox = e.geocode.bbox;
        const poly = L.polygon([
            bbox.getSouthEast(),
            bbox.getNorthEast(),
            bbox.getNorthWest(),
            bbox.getSouthWest()
        ]);
        map.fitBounds(poly.getBounds());
    })
    .addTo(map);

L.Control.LocateMe = L.Control.extend({
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        container.style.backgroundColor = 'white';
        container.style.width = '34px';
        container.style.height = '34px';
        container.style.cursor = 'pointer';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        container.innerHTML = '<i class="material-icons" style="font-size: 20px; color: #333;">my_location</i>';
        container.title = 'Locate Me';

        container.onclick = function () {
            if (navigator.geolocation) {
                container.style.opacity = '0.5';
                navigator.geolocation.getCurrentPosition(
                    function (position) {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        map.setView([lat, lng], 16);
                        container.style.opacity = '1';
                    },
                    function (error) {
                        alert('Unable to retrieve your location: ' + error.message);
                        container.style.opacity = '1';
                    }
                );
            } else {
                alert('Geolocation is not supported by your browser');
            }
        };

        return container;
    },

    onRemove: function (map) {
    }
});

L.control.locateMe = function (opts) {
    return new L.Control.LocateMe(opts);
};

L.control.locateMe({ position: 'topleft' }).addTo(map);

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
    position: 'topright',
    draw: {
        polyline: false,
        polygon: false,
        circle: false,
        marker: false,
        circlemarker: false,
        rectangle: {
            shapeOptions: {
                color: '#051a94ff',
                weight: 6,
                fillOpacity: 0.1
            }
        }
    },
    edit: {
        featureGroup: drawnItems,
        remove: true
    }
});

map.addControl(drawControl);

const predictionsLayer = new L.FeatureGroup();
map.addLayer(predictionsLayer);

let currentBounds = null;
const MAX_AREA_SQ_KM = 3;

function calculateAreaSqKm(bounds) {
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const width = ne.distanceTo(L.latLng(ne.lat, sw.lng));
    const height = ne.distanceTo(L.latLng(sw.lat, ne.lng));
    return (width * height) / 1000000;
}

map.on(L.Draw.Event.CREATED, function (e) {
    const layer = e.layer;
    const bounds = layer.getBounds();
    const areaSqKm = calculateAreaSqKm(bounds);

    drawnItems.clearLayers();

    if (areaSqKm > MAX_AREA_SQ_KM) {
        showStatus(`Area too large (${areaSqKm.toFixed(2)} km²). Maximum allowed: ${MAX_AREA_SQ_KM} km². Please draw a smaller area.`, 'error');
        currentBounds = null;
        document.getElementById('runBtn').disabled = true;
        return;
    }

    drawnItems.addLayer(layer);
    currentBounds = bounds;
    document.getElementById('runBtn').disabled = false;
    showStatus(`Area selected (${areaSqKm.toFixed(3)} km²). Click "Run AI" to proceed.`, 'info');
});

map.on(L.Draw.Event.DELETED, function (e) {
    currentBounds = null;
    document.getElementById('runBtn').disabled = true;
    hideStatus();
});

const CONFIG = {
    servers: {
        dev: 'https://predictor-dev.fair.hotosm.org',
        prod: 'https://predictor.fair.hotosm.org'
    },
    models: {
        ramp: '/mnt/efsmount/fairdev/data/basemodels/ramp/baseline.tflite',
        yolov8v1: '/mnt/efsmount/fairdev/data/basemodels/yolo/yolov8s_v1-seg.onnx',
        yolov8v2: '/mnt/efsmount/fairdev/data/basemodels/yolo/yolov8s_v2-seg.onnx'
    }
};

function getFormValues() {
    const server = document.querySelector('input[name="server"]:checked').value;
    const model = document.querySelector('input[name="model"]:checked').value;
    const confidence = parseFloat(document.getElementById('confidence').value);
    const area = parseFloat(document.getElementById('area').value);
    const tolerance = parseFloat(document.getElementById('tolerance').value);
    const orthogonalize = document.getElementById('orthogonalize').checked;

    return {
        server,
        model,
        confidence,
        area,
        tolerance,
        orthogonalize
    };
}

function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.classList.remove('hidden', 'bg-green-100', 'text-green-800', 'bg-red-100', 'text-red-800', 'bg-blue-100', 'text-blue-800');

    if (type === 'success') {
        statusEl.classList.add('bg-green-100', 'text-green-800');
    } else if (type === 'error') {
        statusEl.classList.add('bg-red-100', 'text-red-800');
    } else {
        statusEl.classList.add('bg-blue-100', 'text-blue-800');
    }
}

function hideStatus() {
    const statusEl = document.getElementById('statusMessage');
    statusEl.classList.add('hidden');
}

async function runPrediction() {
    if (!currentBounds) {
        showStatus('Please draw a rectangle on the map first.', 'error');
        return;
    }

    const formValues = getFormValues();
    const bbox = [
        currentBounds.getWest(),
        currentBounds.getSouth(),
        currentBounds.getEast(),
        currentBounds.getNorth()
    ];

    const payload = {
        bbox: bbox,
        checkpoint: CONFIG.models[formValues.model],
        confidence: formValues.confidence,
        area_threshold: formValues.area,
        tolerance: formValues.tolerance,
        orthogonalize: formValues.orthogonalize,
        ortho_max_angle_change_deg: 15,
        ortho_skew_tolerance_deg: 15,
        source: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
        zoom_level: 19
    };

    const url = `${CONFIG.servers[formValues.server]}/predict/`;

    const runBtn = document.getElementById('runBtn');
    const runIcon = document.getElementById('runIcon');
    const runText = document.getElementById('runText');

    try {
        showStatus('Running prediction...', 'info');
        runBtn.disabled = true;
        runIcon.classList.add('animate-spin');
        runIcon.textContent = 'sync';
        runText.textContent = 'Processing...';

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const geojson = await response.json();

        predictionsLayer.clearLayers();

        const geoJsonLayer = L.geoJSON(geojson, {
            style: {
                color: '#ff4081',
                weight: 2,
                fillOpacity: 0,
                opacity: 1
            }
        });

        predictionsLayer.addLayer(geoJsonLayer);

        if (geoJsonLayer.getBounds().isValid()) {
            map.fitBounds(geoJsonLayer.getBounds());
        }

        const featureCount = geojson.features ? geojson.features.length : 0;
        showStatus(`Success! Found ${featureCount} building(s).`, 'success');

    } catch (error) {
        console.error('Prediction error:', error);
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        runBtn.disabled = false;
        runIcon.classList.remove('animate-spin');
        runIcon.textContent = 'play_arrow';
        runText.textContent = 'Run AI';
    }
}

document.getElementById('runBtn').addEventListener('click', runPrediction);

if (typeof componentHandler !== 'undefined') {
    componentHandler.upgradeDom();
}
