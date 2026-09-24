// 장소 → 1인칭 장면(.spz) 연결.
// 장소에 생성된 장면(stop.scene)이 있으면 그걸 쓰고, 없으면 카테고리에 맞는 샘플로 대체한다.
// 샘플 출처: Spark 예제 에셋 (https://github.com/sparkjsdev/spark/blob/main/examples/assets.json)
// position: 장면을 옮길 오프셋 (카메라는 원점에서 -z 방향을 보고 시작)
const SAMPLES = {
  valley: {
    url: "https://sparkjs.dev/assets/splats/valley.spz",
    position: [0, 0, -3],
    label: "계곡 샘플",
    credit: "Spark 예제 에셋",
  },
  street: {
    url: "https://sparkjs.dev/assets/splats/snow-street.spz",
    position: [-8, -12, -104], // Spark particle-simulation 예제와 같은 배치
    label: "거리 샘플",
    credit: "Spark 예제 에셋",
  },
};

const SAMPLE_BY_CATEGORY = {
  자연: "valley",
  명소: "street",
  문화: "street",
  음식: "street",
  카페: "street",
  쇼핑: "street",
  야경: "street",
  숙소: "street",
};

export function sceneFor(stop) {
  if (stop.scene?.url) return { ...stop.scene, sample: false };
  const key = SAMPLE_BY_CATEGORY[stop.category] ?? "street";
  return { ...SAMPLES[key], sample: true };
}
