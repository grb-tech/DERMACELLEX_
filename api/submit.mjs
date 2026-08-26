export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ status: 'ok', method: req.method });

  const TOKEN = process.env.NOTION_TOKEN;
  if (!TOKEN) return res.status(500).json({ success: false, error: 'NOTION_TOKEN not set' });

  const errors = [];
  let clientPageId = null;

  try {
    const data = req.body;
    const c = data.customer;
    const raw = data.sectionRaw || {};
    const sc = data.sectionScores || {};
    const svc = data.selectedService || data.recommendedService;
    const mismatch = data.selectedService && data.selectedService !== data.recommendedService;
    const svcVotes = data.svcVotes || {};
    const totalScore = Math.round(data.totalScore || 0);

    // 고객등급 계산
    const grade = totalScore >= 90 ? 'S' : totalScore >= 80 ? 'A' : totalScore >= 70 ? 'B'
      : totalScore >= 60 ? 'C' : totalScore >= 50 ? 'D' : totalScore >= 40 ? 'E' : 'F';

    const meetDt1 = c.meetingDate1 && c.meetingTime1 ? `${c.meetingDate1}T${c.meetingTime1}:00+09:00` : null;
    const meetDt2 = c.meetingDate2 && c.meetingTime2 ? `${c.meetingDate2}T${c.meetingTime2}:00+09:00` : null;

    const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://dermacellex-sxip.vercel.app';

    // ─── 1. 의뢰사 DB ───
    const clientProps = {
      '법인 · 개인명': { title: [{ text: { content: c.businessName || '' } }] },
      '담당자명': { rich_text: [{ text: { content: c.name || '' } }] },
      '연락처': { phone_number: c.phone || null },
      '이메일': { email: c.email || null },
      '상태': { status: { name: '문의접수' } },
      '개발의뢰서': { select: { name: data.willWriteDoc ? '작성예정' : '미작성' } },
      '문의경로': { multi_select: (c.inquirySource || []).map(x => ({ name: x })) },
    };
    if (c.country) clientProps['국가'] = { select: { name: c.country } };
    if (c.businessType) clientProps['사업자 구분'] = { select: { name: c.businessType } };

    const clientPage = await notionCall(TOKEN, 'POST', '/pages', {
      parent: { database_id: '3a74c864712880a09e70d7a860e39920' },
      properties: clientProps,
    });
    clientPageId = clientPage.id;

    // 개발의뢰서 링크 (URL 속성)
    if (data.willWriteDoc) {
      const formUrl = `${BASE_URL}/form?client=${clientPage.id}`;
      await notionCall(TOKEN, 'PATCH', `/pages/${clientPage.id}`, {
        properties: { '기획개발의뢰서 링크': { url: formUrl } },
      });
    }

    // ─── 2. 고객 진단 스코어링 DB ───
    try {
      const questions = data.questions || [];
      const scoreProps = {
        '의뢰사명': { title: [{ text: { content: `${c.businessName} 스코어링` } }] },
        '의뢰사': { relation: [{ id: clientPage.id }] },
        '총점': { number: totalScore },
        '고객등급': { select: { name: grade } },
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

      // Q1~Q20 표
      const scoreChildren = [
        { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📋 진단 응답 상세' } }] } },
      ];
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
          tableRows.push({ object: 'block', type: 'table_row', table_row: { cells: [
            [{ type: 'text', text: { content: `Q${i+1}` } }],
            [{ type: 'text', text: { content: q.section || '' } }],
            [{ type: 'text', text: { content: (q.question || '').substring(0, 95) } }],
            [{ type: 'text', text: { content: q.selectedText || '' } }],
            [{ type: 'text', text: { content: String(q.score ?? '') } }],
          ] } });
        });
        scoreChildren.push({
          object: 'block', type: 'table', table: {
            table_width: 5, has_column_header: true, has_row_header: false,
            children: tableRows,
          }
        });
      }
      // 점수 환산 + 고객등급 요약
      scoreChildren.push(
        { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📊 평가 결과' } }] } },
        { object: 'block', type: 'callout', callout: {
          icon: { type: 'emoji', emoji: '🏆' },
          rich_text: [{ type: 'text', text: { content: `총점: ${totalScore}점 / 100점\n고객등급: ${grade}\n추천 서비스: ${data.recommendedService}\n희망 서비스: ${svc}${mismatch ? ' ⚠️ 불일치' : ''}` } }]
        }},
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: {
          content: `S1 사업·브랜드: ${Math.round(sc[1]||0)}점\nS2 제품·생산: ${Math.round(sc[2]||0)}점\nS3 생산·발주: ${Math.round(sc[3]||0)}점\nS4 프로젝트 실행: ${Math.round(sc[4]||0)}점\nS5 판매·협업: ${Math.round(sc[5]||0)}점`
        } }] } },
      );

      await notionCall(TOKEN, 'POST', '/pages', {
        parent: { database_id: 'f36c3ab0bf9f421a8a24ea89abbdd8a3' },
        properties: scoreProps,
        children: scoreChildren,
      });
    } catch (e) {
      errors.push('scoring: ' + e.message);
      console.error('Scoring DB error:', e.message);
    }

    // ─── 3. 미팅 스케줄 DB ───
    try {
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
    } catch (e) {
      errors.push('meeting: ' + e.message);
      console.error('Meeting DB error:', e.message);
    }

    return res.status(200).json({
      success: true,
      pageId: clientPage.id,
      grade,
      totalScore,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ success: false, error: err.message, pageId: clientPageId, partialErrors: errors });
  }
}

async function notionCall(token, method, endpoint, body) {
  const r = await fetch('https://api.notion.com/v1' + endpoint, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Notion ' + r.status + ': ' + JSON.stringify(d));
  return d;
}
