const C = window.Cesium;
const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  if ($("status").textContent !== text) $("status").textContent = text;
  $("status").dataset.error = String(error);
};
const terrainURL = "https://tile.plateauview.mlit.go.jp/terrain";
const imageryURL = "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg";
let viewer, buildings, roads, trip, availability, sources, routes = [];
let terrainReady = false, terrainFailed = false, imageryFailed = false, capturing = false;
let tileErrors = 0, tileLoads = 0, bootComplete = false;
const cameras = {
  overview: {lng:139.74544, lat:35.6585639, height:100, heading:-25, pitch:-38, range:1450},
  tower: {lng:139.74544, lat:35.6585639, height:185, heading:-35, pitch:-17, range:660},
  road: {lng:139.74544, lat:35.6585639, height:52, heading:85, pitch:-38, range:460},
}; // Presentation parameters, not measurements or a verified ground-level camera path.

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

function updateStatus() {
  if (capturing || !bootComplete) return;
  if (tileErrors || terrainFailed || imageryFailed) {
    status(`${[tileErrors ? "건물·도로" : "", terrainFailed ? "지형" : "", imageryFailed ? "항공사진" : ""].filter(Boolean).join(" · ")} 일부 로딩 실패. 새로고침 후 다시 확인해 주세요.`, true);
    $("capture").disabled = true;
  } else {
    const ready = terrainReady && buildings.tilesLoaded && roads.tilesLoaded && viewer.scene.globe.tilesLoaded;
    status(ready ? "실제 건물·도로 표시 중 · 건물을 눌러 원본 확인" : `${[!terrainReady ? "지형 연결" : "", !buildings.tilesLoaded ? "건물" : "", !roads.tilesLoaded ? "도로" : "", !viewer.scene.globe.tilesLoaded ? "지형·항공사진" : ""].filter(Boolean).join(" · ")} 불러오는 중…`);
    $("capture").disabled = !ready || tileLoads === 0;
  }
}

function camera(name, duration = 1.5) {
  const p = cameras[name];
  if (!viewer || !p || capturing) return;
  const center = C.Cartesian3.fromDegrees(p.lng, p.lat, p.height);
  viewer.camera.flyToBoundingSphere(new C.BoundingSphere(center, 1), {
    offset: new C.HeadingPitchRange(C.Math.toRadians(p.heading), C.Math.toRadians(p.pitch), p.range), duration,
  });
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
}

function inspect(feature) {
  if (!feature || typeof feature.getProperty !== "function") {
    $("selection").hidden = true;
    return;
  }
  const get = (key) => feature.getProperty(key);
  $("selected-name").textContent = get('gml:name') || (get('feature_type') === 'Building' ? '이름 미등록 건물' : '선택한 실제 객체');
  $("selected-fields").replaceChildren();
  const fields = [['객체 ID','gml_id'],['종류','feature_type'],['건물 높이','bldg:measuredHeight'],['층수','bldg:storeysAboveGround'],['도로 폭','uro:RoadStructureAttribute_uro:width'],['모델 상세도','_lod'],['생성일','core:creationDate']];
  for (const [label,key] of fields) {
    const val = get(key);
    if (val === undefined || val === null || val === '') continue;
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = `${typeof val === 'object' ? JSON.stringify(val) : val}${['bldg:measuredHeight','uro:RoadStructureAttribute_uro:width'].includes(key) ? ' m' : ''}`;
    $("selected-fields").append(dt,dd);
  }
  $("selection").hidden = false;
}

async function tiles(id) {
  const row = availability.datasets.find((r) => r.id === id);
  if (!row) throw new Error(`Missing source dataset ${id}`);
  const set = await C.Cesium3DTileset.fromUrl(row.url, {
    maximumScreenSpaceError: 3,
    cacheBytes: 192 * 1024 * 1024,
    maximumCacheOverflowBytes: 96 * 1024 * 1024,
    cullWithChildrenBounds: true,
    customShader: new C.CustomShader({lightingModel:C.LightingModel.UNLIT}),
  });
  if (id === '13103_bldg_lod3') {
    // LOD1 buildings in the source are untextured extrusions. Neutral gray instead of pure
    // white is a display choice; geometry is unchanged and textured LOD2+ keeps its photos.
    set.style = new C.Cesium3DTileStyle({color: {conditions: [["${_lod} === 1", "color('#b4b8b3')"], ['true', "color('white')"]]}});
  }
  if (id === '13103_tran_lod3') {
    // The sampled official road GLB has no images or base-color texture.
    // Neutral display color is a rendering choice, not a measured surface color.
    set.style = new C.Cesium3DTileStyle({color: "color('#7c837f', 0.72)"});
  }
  set.tileFailed.addEventListener((event) => { tileErrors++; console.error('3D tile failed', event.message); updateStatus(); });
  set.tileLoad.addEventListener(() => { tileLoads++; updateStatus(); });
  set.loadProgress.addEventListener(updateStatus);
  viewer.scene.primitives.add(set);
  return set;
}

function showRoutes() {
  for (const entity of routes) entity.show = $("route").checked;
  viewer.scene.requestRender();
}

function frame() {
  return new Promise((resolve) => {
    const remove = viewer.scene.postRender.addEventListener(() => { remove(); resolve(); });
    viewer.scene.requestRender();
  });
}

function edgeImage(canvas) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width; copy.height = canvas.height;
  const ctx = copy.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(canvas, 0, 0);
  const image = ctx.getImageData(0,0,copy.width,copy.height);
  const {width:w,height:h,data} = image;
  const luminance = new Float32Array(w*h);
  for (let i=0;i<w*h;i++) luminance[i] = .2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
  data.fill(0);
  for (let i=0;i<w*h;i++) data[i*4+3]=255;
  for (let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
    const i=y*w+x;
    const gx=-luminance[i-w-1]+luminance[i-w+1]-2*luminance[i-1]+2*luminance[i+1]-luminance[i+w-1]+luminance[i+w+1];
    const gy=-luminance[i-w-1]-2*luminance[i-w]-luminance[i-w+1]+luminance[i+w-1]+2*luminance[i+w]+luminance[i+w+1];
    const edge=Math.min(255,Math.hypot(gx,gy));
    data[i*4]=data[i*4+1]=data[i*4+2]=edge;
  }
  ctx.putImageData(image,0,0);
  return copy.toDataURL('image/png');
}

async function capture() {
  if (capturing || $("capture").disabled) return;
  capturing=true;
  const controls=[...document.querySelectorAll('button,input')];
  controls.forEach((element) => element.disabled=true);
  viewer.camera.cancelFlight();
  viewer.scene.screenSpaceCameraController.enableInputs=false;
  routes.forEach((entity)=>entity.show=false);
  status('현재 시점과 원본 출처를 저장하는 중…');
  try {
    await frame();
    const canvas=viewer.scene.canvas;
    const payload={schema_version:1,kind:'rendered_reference_not_observed_photo',model_executed:false,
      created_at:new Date().toISOString(),viewport:{width:canvas.width,height:canvas.height},
      camera:{reference:'WGS84 ECEF; meters',position:C.Cartesian3.pack(viewer.camera.positionWC,[]),direction:C.Cartesian3.pack(viewer.camera.directionWC,[]),up:C.Cartesian3.pack(viewer.camera.upWC,[]),projection_matrix:C.Matrix4.toArray(viewer.camera.frustum.projectionMatrix)},
      datasets:availability.datasets.filter(r=>['13103_bldg_lod3','13103_tran_lod3'].includes(r.id)),
      manifests:sources,terrain_url:terrainURL,imagery_url:imageryURL,
      layers:{buildings:buildings.show,roads:roads.show,route:false},
      notices:['PLATEAU / 港区; PLATEAU | Mapterhorn | 国土地理院','Rendered from supplied data. Not a ground-truth photograph.','Live tile bodies may change; Phase 0 hashes cover manifests only.','Sobel edge image is a candidate input, not a completed Cosmos run.'],
      rgb_png:canvas.toDataURL('image/png'),edge_png:edgeImage(canvas),edge_method:'Sobel on rendered RGB luminance, unthresholded magnitude',
    };
    const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
    const link=document.createElement('a');const url=URL.createObjectURL(blob);
    link.href=url;link.download=`tokyo-reference-${new Date().toISOString().replaceAll(':','-')}.json`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    status('비교용 파일을 저장했습니다.');
  } catch(error) { console.error(error);status('저장하지 못했습니다. 외부 데이터의 로딩 상태를 확인해 주세요.',true); }
  finally {
    capturing=false;controls.forEach((element)=>element.disabled=false);
    viewer.scene.screenSpaceCameraController.enableInputs=true;
    showRoutes();updateStatus();
  }
}

async function init() {
  if (!C) throw new Error('3D 엔진을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
  C.Ion.defaultAccessToken='';
  [availability,trip,sources]=await Promise.all([json('/data/realworld/availability.json'),json('/data/day1.json'),json('/data/realworld/sources.json')]);
  viewer=new C.Viewer('map',{
    baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,
    navigationHelpButton:false,fullscreenButton:false,animation:false,timeline:false,infoBox:false,
    selectionIndicator:false,requestRenderMode:true,maximumRenderTimeChange:Infinity,
    contextOptions:{webgl:{preserveDrawingBuffer:true,alpha:false}},
    shadows:false,
  });
  viewer.resolutionScale=Math.min(window.devicePixelRatio || 1,1.5);
  viewer.scene.globe.depthTestAgainstTerrain=true;
  viewer.scene.globe.baseColor=C.Color.fromCssColorString('#ccd6ca');
  viewer.scene.backgroundColor=C.Color.fromCssColorString('#dfe8e4');
  viewer.scene.fog.enabled=true;
  viewer.scene.postProcessStages.fxaa.enabled=true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance=35;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance=7000;
  const imagery=new C.UrlTemplateImageryProvider({url:imageryURL,minimumLevel:10,maximumLevel:18,rectangle:C.Rectangle.fromDegrees(139.70,35.61,139.79,35.69),credit:'国土地理院 seamlessphoto'});
  imagery.errorEvent.addEventListener(error=>{if(error.timesRetried<1){error.retry=true;return;} imageryFailed=true;console.warn('Imagery unavailable',error.message);updateStatus();});
  viewer.imageryLayers.addImageryProvider(imagery);
  const terrainTask=C.CesiumTerrainProvider.fromUrl(terrainURL,{requestVertexNormals:true}).then(provider=>{
    provider.errorEvent.addEventListener(()=>{terrainFailed=true;updateStatus();});
    viewer.terrainProvider=provider;terrainReady=true;
  }).catch(error=>{terrainFailed=true;console.error('Terrain failed',error);});
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(updateStatus);
  viewer.scene.renderError.addEventListener((_scene,error)=>{status(`3D 표시 오류: ${error.message}`,true);$("capture").disabled=true;});
  camera('overview',0);
  [buildings,roads]=await Promise.all([tiles('13103_bldg_lod3'),tiles('13103_tran_lod3')]);
  await terrainTask;
  // Clamped to terrain, not building roofs; retain OSM geometry and unverified connectors.
  routes=trip.legs.filter(l=>l.geometry).map(leg=>viewer.entities.add({show:false,polyline:{
    positions:C.Cartesian3.fromDegreesArray(leg.geometry.coordinates.flat()),width:4,clampToGround:true,
    classificationType:C.ClassificationType.TERRAIN,material:C.Color.fromCssColorString('#e5a334'),
  }}));
  viewer.screenSpaceEventHandler.setInputAction(event=>inspect(viewer.scene.pick(event.position)),C.ScreenSpaceEventType.LEFT_CLICK);
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>camera(b.dataset.view)));
  $("buildings").addEventListener('change',()=>{buildings.show=$("buildings").checked;viewer.scene.requestRender();updateStatus();});
  $("roads").addEventListener('change',()=>{roads.show=$("roads").checked;viewer.scene.requestRender();updateStatus();});
  $("route").addEventListener('change',showRoutes);
  $("close-selection").addEventListener('click',()=>$("selection").hidden=true);
  $("capture").addEventListener('click',capture);
  viewer.camera.moveEnd.addEventListener(updateStatus);
  viewer.scene.postRender.addEventListener(updateStatus);
  bootComplete=true;updateStatus();
  if (new URLSearchParams(location.search).has('export')) {
    const {install}=await import('./export.js');
    install({viewer,C,tilesets:[buildings,roads],trip});
  }
}

init().catch(error=>{console.error(error);status(`불러오기 실패: ${error.message}`,true);});
