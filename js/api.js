/**
 * Google Apps Script API 통신 모듈
 * - SCRIPT_URL 미설정 시 DemoAPI(js/api-demo.js)로 위임
 * - 관리자 요청은 전부 POST + 세션 토큰 방식 (비밀번호를 URL에 싣지 않음)
 */
const API = {
  get _demo() {
    return !CONFIG.SCRIPT_URL;
  },

  async _get(params) {
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`)
      .join('&');
    const res = await fetch(`${CONFIG.SCRIPT_URL}?${query}&_t=${Date.now()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  async _post(body) {
    const res = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  // === 초기 로딩: 설정 + 강사 목록 + 예약을 한 번에 조회 ===
  async getInit(date, instructor) {
    if (this._demo) return DemoAPI.getInit(date, instructor);
    const data = await this._get({ action: 'getInit', date, instructor: instructor || '' });
    // 설정/강사 목록 캐시 (다음 방문 시 즉시 렌더용)
    if (data.instructors) sessionStorage.setItem('cached_instructors', JSON.stringify(data.instructors));
    if (data.config) sessionStorage.setItem('cached_config', JSON.stringify(data.config));
    return {
      config: data.config || null,
      instructors: data.instructors || [],
      bookings: data.bookings || [],
      roomBlocks: data.roomBlocks || [],
    };
  },

  getCachedInstructors() {
    try {
      return JSON.parse(sessionStorage.getItem('cached_instructors'));
    } catch { return null; }
  },

  getCachedConfig() {
    try {
      return JSON.parse(sessionStorage.getItem('cached_config'));
    } catch { return null; }
  },

  // === 예약 조회 ===
  async getBookings(date, instructor) {
    if (this._demo) return DemoAPI.getBookings(date, instructor);
    const data = await this._get({ action: 'getBookings', date, instructor: instructor || '' });
    return { bookings: data.bookings || [], roomBlocks: data.roomBlocks || [] };
  },

  // 주간 뷰 (start = 주 시작일)
  async getWeek(start, instructor) {
    if (this._demo) return DemoAPI.getWeek(start, instructor);
    const data = await this._get({ action: 'getWeek', start, instructor: instructor || '' });
    return { days: data.days || [] };
  },

  // === 예약 CRUD ===
  async createBooking(booking) {
    if (this._demo) return DemoAPI.createBooking(booking);
    return this._post({ action: 'create', ...booking });
  },

  async updateBooking(id, booking, password) {
    if (this._demo) return DemoAPI.updateBooking(id, booking, password);
    return this._post({ action: 'update', id, ...booking, password });
  },

  async deleteBooking(id, password) {
    if (this._demo) return DemoAPI.deleteBooking(id, password);
    return this._post({ action: 'delete', id, password });
  },

  // === 내 예약 조회 ===
  async getMyBookings(name, password) {
    if (this._demo) return DemoAPI.getMyBookings(name, password);
    return this._post({ action: 'getMyBookings', name, password });
  },

  // === 관리자 ===
  async adminLogin(password) {
    if (this._demo) return DemoAPI.adminLogin(password);
    return this._post({ action: 'adminLogin', password });
  },

  // 대시보드 초기 데이터 (설정 + 강사 + 통계 + 차단 목록)
  async adminInit(token) {
    if (this._demo) return DemoAPI.adminInit(token);
    return this._post({ action: 'adminInit', token });
  },

  async adminGetAllBookings(token, page, search) {
    if (this._demo) return DemoAPI.adminGetAllBookings(token, page, search);
    return this._post({ action: 'adminGetAll', token, page, search: search || '' });
  },

  async adminDeleteBooking(id, token) {
    if (this._demo) return DemoAPI.adminDeleteBooking(id, token);
    return this._post({ action: 'adminDelete', id, token });
  },

  async adminExport(token) {
    if (this._demo) return DemoAPI.adminExport(token);
    return this._post({ action: 'adminExport', token });
  },

  // === 강사 관리 ===
  async getInstructors() {
    if (this._demo) return DemoAPI.getInstructors();
    const data = await this._get({ action: 'getInstructors' });
    return data.instructors || [];
  },

  async adminAddInstructor(name, token) {
    if (this._demo) return DemoAPI.adminAddInstructor(name, token);
    return this._post({ action: 'addInstructor', name, token });
  },

  async adminUpdateInstructor(oldName, newName, token) {
    if (this._demo) return DemoAPI.adminUpdateInstructor(oldName, newName, token);
    return this._post({ action: 'updateInstructor', oldName, newName, token });
  },

  async adminDeleteInstructor(name, token, force) {
    if (this._demo) return DemoAPI.adminDeleteInstructor(name, token, force);
    return this._post({ action: 'deleteInstructor', name, token, force: force === true });
  },

  // === 룸 차단 ===
  async adminAddBlock(block, token) {
    if (this._demo) return DemoAPI.adminAddBlock(block, token);
    return this._post({ action: 'addBlock', ...block, token });
  },

  async adminDeleteBlock(id, token) {
    if (this._demo) return DemoAPI.adminDeleteBlock(id, token);
    return this._post({ action: 'deleteBlock', id, token });
  },
};
