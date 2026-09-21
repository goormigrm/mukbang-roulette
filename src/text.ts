// 한글 줄바꿈 도우미
//
// `word-break: keep-all`은 단어 중간에서 끊기는 것만 막아 줄 뿐, 줄이 어디서 넘어갈지는 고르지 못한다.
// 그래서 "더 이상 메뉴가 / 추가되지 않습니다"처럼 한 문장이 어중간하게 갈려 읽기 어려워진다.
//
// 여기서는 문장을 **구(句) 단위 덩어리**로 묶는다. 화면에서는 각 덩어리를 inline-block으로 깔아
// 덩어리 통째로 다음 줄로 넘어가게 하므로, 줄은 항상 말이 끊기지 않는 자리에서 넘어간다.

/** 이 조사로 끝나는 어절은 뒤 어절과 붙어 다닌다 ("메뉴가 추가되지", "…에 합쳤습니다") */
const BIND_AFTER =
  /(?:이|가|은|는|을|를|의|에|에서|에게|께|으로|로|와|과|랑|도|만|까지|부터|보다|처럼|마다|대로|밖에|조차)["'’」』)\]]?$/

/** 이 말들은 혼자 설 수 없어 앞 어절에 붙는다 ("3,000원 이상", "반영되지 않습니다") */
const BIND_BEFORE = /^(?:않|안|못|이상|이하|미만|때문|만큼|뿐|등|및|수|것|중|따라|대해|위해)/

/** 뒤 어절을 꾸미므로 뒤와 붙어 다니는 부사 ("이미 / 있는"처럼 갈리지 않게) */
const ADVERBS = new Set([
  '안', '못', '더', '잘', '또', '막', '곧', '꼭', '전부', '모두',
  '이미', '아직', '벌써', '방금', '이제', '계속', '다시', '직접', '그냥', '바로', '함께', '매우', '아주', '가장', '곧바로',
])

/** 한 덩어리가 너무 길어지면 오히려 줄 끝이 들쭉날쭉해지므로 이쯤에서 끊는다 */
const MAX_CHUNK = 18

/** 괄호·따옴표가 아직 안 닫혔는가 — "(필요하면 / 직접 추가)"나 "부대 / 찌개" 처럼 갈리지 않게 */
function stillOpen(chunk: string): boolean {
  const n = (re: RegExp): number => (chunk.match(re) ?? []).length
  if (n(/[([{]/g) > n(/[)\]}]/g)) return true
  if (n(/[“‘「『]/g) > n(/[”’」』]/g)) return true
  return n(/"/g) % 2 === 1
}

/** 문장을 "끊어도 되는 자리"로만 나눈 덩어리 목록으로 바꾼다 */
export function koPhrases(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const w of words) {
    const prev = out.length > 0 ? out[out.length - 1] : null
    const prevLast = prev ? (prev.split(' ').pop() ?? '') : ''
    const mustGlue =
      prev !== null &&
      (stillOpen(prev) || BIND_AFTER.test(prevLast) || BIND_BEFORE.test(w) || ADVERBS.has(prevLast))
    if (!mustGlue) {
      out.push(w)
    } else if (prev!.length + w.length + 1 <= MAX_CHUNK) {
      out[out.length - 1] = `${prev!} ${w}`
    } else {
      // 덩어리가 길어져 더 못 붙이면, 붙어 있어야 하는 두 어절만 떼어 새 덩어리로 만든다
      // (한도 때문에 "…에 / 합쳤습니다"처럼 갈리는 일이 없게)
      const rest = prev!.split(' ')
      const last = rest.pop() ?? ''
      if (rest.length > 0) out[out.length - 1] = rest.join(' ')
      else out.pop()
      out.push(`${last} ${w}`)
    }
  }
  return out
}
