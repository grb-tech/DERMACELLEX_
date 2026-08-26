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
    const svcVotes = data.svcVotes || {};
    const scoreText = Object.entries(sc).map(([k, v]) => `S${k}: ${Math.round(v)}점`).join(' / ');

    // ─── 1. 의뢰사 DB (간소화) ───
    const meetDt1 = c.meetingDate1 && c.meetingTime1 ? `${c.meetingDate1}T${c.meetingTime1}:00+09:00` : c.meetingDate1 || null;
    const meetDt2 = c.meetingDate2 && c.meetingTime2 ? `${c.meetingDate2}T${c.meetingTime2}:00+09:00` : c.meetingDate2 || null;

    const clientProps = {
      '법인 · 개인명': { title: [{ text: { content: c.businessName || '' } }] },
      '담당자명': { rich_text: [{ text: { content: c.name || '' } }] },
      '연락처': { phone_number: c.phone || null },
      '이메일': { email: c.email || null },
      '스코어링': { rich_text: [{ text: { content: `총${Math.round(data.totalScore||0)}점 | ${scoreText}` } }] },
      '상태': { status: { name: '문의접수' } },
      '개발의뢰서': { select: { name: data.willWriteDoc ? '작성예정' : '미작성' } },
    };
    if (c.country) clientProps['국가'] = { select: { name: c.country } };
    if (c.businessType) clientProps['사업자 구분'] = { select: { name: c.businessType } };
    if (meetDt1) clientProps['희망 미팅일1'] = { date: { start: meetDt1 } };
    if (meetDt2) clientProps['희망 미팅일2'] = { date: { start: meetDt2 } };

    const clientChildren = [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '👤 고객 정보' } }] } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: {
        content: `이름: ${c.name}\n연락처: ${c.phone}\n이메일: ${c.email}\n국가: ${c.country}\n사업자: ${c.businessType || ''} · ${c.businessName}`
      } }] } },
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '☑️ TODO' } }] } },
      { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: '담당자 배정' } }], checked: false } },
      { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: '가이드 메일 발송' } }], checked: false } },
      { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: '미팅 일정 확정' } }], checked: false } },
      { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: '1차 ZOOM 미팅' } }], checked: false } },
    ];

    const clientPage = await notionCall(TOKEN, 'POST', '/pages', {
      parent: { database_id: '3a74c864712880a09e70d7a860e39920' },
      properties: clientProps,
      children: clientChildren,
    });

    // ─── 2. 기획개발의뢰서 링크 ───
    const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://dermacellex-sxip.vercel.app';
    const formUrl = `${BASE_URL}/form?client=${clientPage.id}`;

    if (data.willWriteDoc) {
      await notionCall(TOKEN, 'PATCH', `/blocks/${clientPage.id}/children`, {
        children: [
          { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📝 기획개발의뢰서' } }] } },
          { object: 'block', type: 'bookmark', bookmark: { url: formUrl } },
        ]
      });
    }

    // ─── 3. 스코어링 DB (Q1~Q20 선택내용 표 포함) ───
    const answers = data.answers || {};
    const questions = data.questions || [];

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
      '책임판매업': { select: { name: c.hasLicense || '미등록' } },
      '03류 상표': { select: { name: c.hasTrademark || '미보유' } },
      'OEM·ODM 자격': { select: { name: (c.hasTrademark === '보유' && c.hasLicense === '등록완료') ? '충족' : '미충족' } },
      '유통국가': { multi_select: (c.distributionCountries || []).map(x => ({ name: x })) },
      'S1 사업브랜드': { number: raw[1] || 0 },
      'S2 제품생산': { number: raw[2] || 0 },
      'S3 생산발주': { number: raw[3] || 0 },
      'S4 프로젝트': { number: raw[4] || 0 },
      'S5 판매협업': { number: raw[5] || 0 },
      '진단일시': { date: { start: new Date().toISOString().substring(0, 10) } },
    };

    // Build Q1~Q20 answer table as page content
    const scoreChildren = [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📋 진단 응답 상세' } }] } },
    ];

    // Build table: header + 20 rows
    if (questions.length > 0) {
      const tableRows = [
        { object: 'block', type: 'table_row', table_row: { cells: [
          [{ type: 'text', text: { content: 'NO' } }],
          [{ type: 'text', text: { content: '섹션' } }],
          [{ type: 'text', text: { content: '질문' } }],
          [{ type: 'text', text: { content: '선택 응답' } }],
          [{ type: 'text', text: { content: '점수' } }],
        ] } },
      ];
      questions.forEach((q, i) => {
        tableRows.push({
          object: 'block', type: 'table_row', table_row: { cells: [
            [{ type: 'text', text: { content: `Q${i+1}` } }],
            [{ type: 'text', text: { content: q.section || '' } }],
            [{ type: 'text', text: { content: (q.question || '').substring(0, 95) } }],
            [{ type: 'text', text: { content: q.selectedText || '' } }],
            [{ type: 'text', text: { content: String(q.score ?? '') } }],
          ] }
        });
      });
      scoreChildren.push({
        object: 'block', type: 'table', table: {
          table_width: 5, has_column_header: true, has_row_header: false,
          children: tableRows,
        }
      });
    }

    const scorePage = await notionCall(TOKEN, 'POST', '/pages', {
      parent: { database_id: 'f36c3ab0bf9f421a8a24ea89abbdd8a3' },
      properties: scoreProps,
      children: scoreChildren,
    });

    // ─── 4. 미팅 스케줄 DB (1건에 희망1안+2안) ───
    if (meetDt1) {
      const meetProps = {
        '미팅': { title: [{ text: { content: `${c.businessName} 1차 상담` } }] },
        '의뢰사': { relation: [{ id: clientPage.id }] },
        '서비스': { select: { name: svc } },
        '미팅 유형': { select: { name: '1차 상담' } },
        '상태': { status: { name: '시작 전' } },
        '희망 미팅일1': { date: { start: meetDt1 } },
      };
      if (meetDt2) meetProps['희망 미팅일2'] = { date: { start: meetDt2 } };
      await notionCall(TOKEN, 'POST', '/pages', {
        parent: { database_id: '805deccdbbaa44d0877959ef38e8969f' },
        properties: meetProps,
      });
    }

    return res.status(200).json({ success: true, pageId: clientPage.id, formUrl });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function notionCall(token, method, endpoint, body) {
  const r = await fetch('https://api.notion.com/v1' + endpoint, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Notion ' + r.status + ': ' + (d.message || 'error'));
  return d;
}
