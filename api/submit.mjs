export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ status: 'ok', method: req.method });

  const TOKEN = process.env.NOTION_TOKEN;
  if (!TOKEN) return res.status(500).json({ success: false, error: 'NOTION_TOKEN not set' });

  try {
    const data = req.body;
    const c = data.customer;
    const sc = data.sectionScores || {};
    const raw = data.sectionRaw || {};
    const svc = data.selectedService || data.recommendedService;
    const mismatch = data.selectedService && data.selectedService !== data.recommendedService;

    // Format scores
    const scoreText = Object.entries(sc).map(([k, v]) => `S${k}: ${Math.round(v)}점`).join(' / ');
    const svcVotes = data.svcVotes || {};
    const svcText = Object.entries(svcVotes).sort((a,b) => b[1]-a[1]).map(([k,v]) => `${k}:${v}`).join(' ');

    // ─── Client Page Properties ───
    const properties = {
      '법인 · 개인명': { title: [{ text: { content: c.businessName || '' } }] },
      '담당자명': { rich_text: [{ text: { content: c.name || '' } }] },
      '연락처': { phone_number: c.phone || null },
      '이메일': { email: c.email || null },
      '스코어링': { rich_text: [{ text: { content: `총점:${Math.round(data.totalScore||0)} | ${scoreText} | ${svcText}` } }] },
      '상태': { status: { name: '문의접수' } },
      '유통국가': { multi_select: (c.distributionCountries || []).map(x => ({ name: x })) },
    };

    if (c.country) properties['국가'] = { select: { name: c.country } };
    if (c.businessType) properties['사업자 구분'] = { select: { name: c.businessType } };
    properties['03류 상표'] = { select: { name: c.hasTrademark || '미보유' } };
    const licMap = { '등록완료': '보유', '등록예정': '예정' };
    properties['화장품 책임판매업 등록 여부'] = { select: { name: licMap[c.hasLicense] || '미보유' } };
    if (data.recommendedService) properties['추천사업'] = { select: { name: data.recommendedService } };
    if (svc) properties['희망사업'] = { select: { name: svc } };
    properties['개발의뢰서'] = { select: { name: data.willWriteDoc ? '작성예정' : '미작성' } };

    // Meeting dates
    if (c.meetingDate1) properties['미팅 가능일정 1안'] = { date: { start: c.meetingDate1 } };
    if (c.meetingDate2) properties['미팅 가능일정 2안'] = { date: { start: c.meetingDate2 } };

    // ─── Page Content Blocks ───
    const BASE_URL = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://dermacellex.vercel.app';

    const children = [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📋 접수 정보' } }] } },
      { object: 'block', type: 'callout', callout: {
        icon: { type: 'emoji', emoji: '📌' },
        rich_text: [{ type: 'text', text: { content: `추천: ${data.recommendedService} / 선택: ${svc}${mismatch ? ' ⚠️' : ''}\n총점: ${Math.round(data.totalScore||0)}점` } }]
      }},
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📊 섹션별 점수' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: scoreText } }] } },
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '👤 고객 정보' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: {
        content: `이름: ${c.name}\n연락처: ${c.phone}\n이메일: ${c.email}\n국가: ${c.country}\n사업자: ${c.businessType || ''} · ${c.businessName}\n상표: ${c.hasTrademark}\n책임판매업: ${c.hasLicense}\n유통국가: ${(c.distributionCountries || []).join(', ')}\n미팅 1안: ${c.meetingDate1 || '-'}\n미팅 2안: ${c.meetingDate2 || '-'}`
      } }] } },
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '☑️ TODO' } }] } },
      { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: '담당자 배정' } }], checked: false } },
      { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: '가이드 메일 발송' } }], checked: false } },
      { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: '미팅 일정 확정' } }], checked: false } },
      { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: '1차 ZOOM 미팅' } }], checked: false } },
    ];

    // Create client page
    const clientPage = await notionCall(TOKEN, 'POST', '/pages', {
      parent: { database_id: '3a74c864712880a09e70d7a860e39920' },
      properties,
      children,
    });

    // ─── Dev request form link (append after page creation) ───
    const formUrl = `${BASE_URL}/form?client=${clientPage.id}`;
    await notionCall(TOKEN, 'PATCH', `/blocks/${clientPage.id}/children`, {
      children: [
        { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📝 개발의뢰서' } }] } },
        { object: 'block', type: 'bookmark', bookmark: { url: formUrl } },
      ]
    });

    // ─── Scoring DB Entry ───
    const scoreProps = {
      '의뢰사명': { title: [{ text: { content: `${c.businessName} 스코어링` } }] },
      '의뢰사': { relation: [{ id: clientPage.id }] },
      'OEM': { number: svcVotes.OEM || 0 },
      'ODM': { number: svcVotes.ODM || 0 },
      'OCM': { number: svcVotes.OCM || 0 },
      'OBM': { number: svcVotes.OBM || 0 },
      '추천서비스': { select: { name: data.recommendedService } },
      '희망서비스': { select: { name: svc } },
      '추천 일치': { select: { name: mismatch ? '불일치' : '일치' } },
      '상표 보유': { checkbox: c.hasTrademark === '보유' },
      '책임판매업 등록': { checkbox: c.hasLicense === '등록완료' },
      'OEM·ODM 자격': { select: { name: (c.hasTrademark === '보유' && c.hasLicense === '등록완료') ? '충족' : '미충족' } },
      'S1 사업브랜드': { number: raw[1] || 0 },
      'S2 제품생산': { number: raw[2] || 0 },
      'S3 생산발주': { number: raw[3] || 0 },
      'S4 프로젝트': { number: raw[4] || 0 },
      'S5 판매협업': { number: raw[5] || 0 },
      '진단일시': { date: { start: new Date().toISOString().substring(0, 10) } },
    };

    const scorePage = await notionCall(TOKEN, 'POST', '/pages', {
      parent: { database_id: 'f36c3ab0bf9f421a8a24ea89abbdd8a3' },
      properties: scoreProps,
    });

    // ─── Meeting Schedule DB Entry ───
    if (c.meetingDate1) {
      const meetProps = {
        '미팅': { title: [{ text: { content: `${c.businessName} 1차 상담` } }] },
        '의뢰사': { relation: [{ id: clientPage.id }] },
        '서비스': { select: { name: svc } },
        '미팅 유형': { select: { name: '1차 상담' } },
        '상태': { status: { name: '시작 전' } },
        '일시': { date: { start: c.meetingDate1 } },
      };
      if (c.meetingDate2) meetProps['메모'] = { rich_text: [{ text: { content: `2안: ${c.meetingDate2}` } }] };

      await notionCall(TOKEN, 'POST', '/pages', {
        parent: { database_id: '805deccdbbaa44d0877959ef38e8969f' },
        properties: meetProps,
      });
    }

    return res.status(200).json({
      success: true,
      pageId: clientPage.id,
      pageUrl: clientPage.url,
      scorePageId: scorePage.id,
      formUrl,
    });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function notionCall(token, method, endpoint, body) {
  const r = await fetch('https://api.notion.com/v1' + endpoint, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Notion ' + r.status + ': ' + (d.message || 'error'));
  return d;
}
