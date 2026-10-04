import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchKeyword, searchUrl, encodeKey, parseItems, httpsPhoto, nameScore, pickBest, lookup } from "../lib/tourapi.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/tourapi-search-haeundae.json", import.meta.url)));
const haeundae = { name: "해운대해수욕장", lat: 35.1587, lng: 129.1604 };

test("검색어에서 괄호 설명을 뺀다", () => {
  assert.equal(searchKeyword("해운대 블루라인파크 (스카이캡슐)"), "해운대 블루라인파크");
  assert.equal(searchKeyword("N서울타워"), "N서울타워");
});

test("서비스 키는 인코딩 키·디코딩 키 모두 한 번만 인코딩된다", () => {
  assert.equal(encodeKey("abc%2Bdef%3D%3D"), "abc%2Bdef%3D%3D");
  assert.equal(encodeKey("abc+def=="), "abc%2Bdef%3D%3D");
  const url = searchUrl("abc+def==", "해운대");
  assert.match(url, /serviceKey=abc%2Bdef%3D%3D&/);
  assert.match(url, /_type=json/);
  assert.match(url, /keyword=%ED%95%B4/);
});

test("응답을 장소 배열로 바꾸고 좌표 없는 항목은 버린다", () => {
  const items = parseItems(fixture);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    contentId: "126081",
    contentTypeId: "12",
    title: "해운대해수욕장",
    address: "부산광역시 해운대구 해운대해변로 264 (우동)",
    lat: 35.1588157,
    lng: 129.1586412,
    photo: "https://tong.visitkorea.or.kr/cms/resource/91/2594091_image2_1.jpg",
  });
  // firstimage가 비면 firstimage2
  assert.equal(items[1].photo, "https://tong.visitkorea.or.kr/cms/resource/00/2734100_image3_1.jpg");
});

test("결과 없음(items가 빈 문자열)과 1건(객체)도 처리한다", () => {
  assert.deepEqual(parseItems({ response: { header: { resultCode: "0000" }, body: { items: "" } } }), []);
  const one = parseItems({ response: { header: { resultCode: "0000" }, body: { items: { item: fixture.response.body.items.item[0] } } } });
  assert.equal(one.length, 1);
});

test("오류 코드는 예외로", () => {
  assert.throws(() => parseItems({ response: { header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR." } } }), /TourAPI 30/);
});

test("http 사진 주소는 https로", () => {
  assert.equal(httpsPhoto("http://a/b.jpg"), "https://a/b.jpg");
  assert.equal(httpsPhoto(""), null);
});

test("이름 유사도", () => {
  assert.equal(nameScore("해운대해수욕장", "해운대 해수욕장"), 1);
  assert.equal(nameScore("블루라인파크", "해운대 블루라인파크"), 0.8);
  assert.ok(nameScore("해운대해수욕장", "광안리해수욕장") < 0.6);
  assert.equal(nameScore("", "x"), 0);
});

test("반경 안에서 이름이 가장 비슷한 곳을 고른다 (같은 이름의 먼 지점은 제외)", () => {
  const best = pickBest(haeundae, parseItems(fixture));
  assert.equal(best.contentId, "126081");
  assert.ok(best.km < 0.5);
  // 강남의 '해운대 국밥'은 이름이 비슷해도 반경 밖
  assert.equal(pickBest({ name: "해운대 국밥", lat: 35.16, lng: 129.16 }, parseItems(fixture))?.contentId, undefined);
});

test("lookup: 응답이 JSON이 아니면(키 오류 XML) 예외", async () => {
  const fakeFetch = async () => new Response("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>");
  await assert.rejects(lookup("k", haeundae, fakeFetch), /응답 오류/);
});

test("lookup: 정상 응답이면 매칭 결과", async () => {
  const fakeFetch = async (url) => {
    assert.match(url, /searchKeyword2/);
    return new Response(JSON.stringify(fixture));
  };
  const best = await lookup("k", haeundae, fakeFetch);
  assert.equal(best.title, "해운대해수욕장");
});
