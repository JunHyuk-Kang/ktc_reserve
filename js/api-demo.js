/**
 * 데모 모드 API (SCRIPT_URL 미설정 시)
 * - localStorage에 데이터 저장, 실제 API와 동일한 응답 형태를 반환
 * - 데모에서는 비밀번호를 평문 비교합니다 (운영 모드는 서버에서 SHA-256 해시)
 */
const DemoAPI = {
  ADMIN_PASSWORD: 'admin1234',
  TOKEN: 'demo-token',

  // === 저장소 ===
  _bookings: JSON.parse(localStorage.getItem('demo_bookings') || '[]'),
  _instructors: JSON.parse(localStorage.getItem('demo_instructors') || 'null') || [...(CONFIG.instructors || [])],
  _blocks: JSON.parse(localStorage.getItem('demo_blocks') || '[]'),

  _save() {
    localStorage.setItem('demo_bookings', JSON.stringify(this._bookings));
    localStorage.setItem('demo_instructors', JSON.stringify(this._instructors));
    localStorage.setItem('demo_blocks', JSON.stringify(this._blocks));
  },

  _config() {
    return {
      rooms: [...CONFIG.rooms],
      startHour: CONFIG.startHour,
      endHour: CONFIG.endHour,
      slotMinutes: CONFIG.slotMinutes,
    };
  },

  _requireAdmin(token) {
    if (token !== this.TOKEN) throw new Error('관리자 인증이 만료되었습니다. 다시 로그인해주세요.');
  },

  _public(b) {
    const { password, email, ...rest } = b;
    return rest;
  },

  // === 조회 ===
  async getInit(date, instructor) {
    return {
      config: this._config(),
      instructors: [...this._instructors],
      ...(await this.getBookings(date, instructor)),
    };
  },

  async getBookings(date, instructor) {
    const bookings = [];
    const roomBlocks = [];

    this._bookings.forEach(b => {
      if (b.date !== date) return;
      if (!instructor || b.instructor === instructor) {
        bookings.push(this._public(b));
      } else {
        roomBlocks.push({
          room: b.room, startTime: b.startTime, endTime: b.endTime,
          instructor: b.instructor, type: 'booking',
        });
      }
    });

    this._blocks.forEach(bl => {
      if (bl.date !== date) return;
      roomBlocks.push({
        room: bl.room, startTime: bl.startTime, endTime: bl.endTime,
        reason: bl.reason, type: 'unavailable',
      });
    });

    return { bookings, roomBlocks };
  },

  async getWeek(start, instructor) {
    const parts = start.split('-').map(Number);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(parts[0], parts[1] - 1, parts[2] + i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({
        date,
        bookings: this._bookings
          .filter(b => b.date === date && (!instructor || b.instructor === instructor))
          .map(b => this._public(b)),
      });
    }
    return { days };
  },

  async getInstructors() {
    return [...this._instructors];
  },

  // === 예약 CRUD ===
  _hasConflict(date, room, startTime, endTime, excludeId) {
    const bookingConflict = this._bookings.some(b => {
      if (excludeId && b.id === excludeId) return false;
      return b.date === date && b.room === room && startTime < b.endTime && endTime > b.startTime;
    });
    if (bookingConflict) return true;
    return this._blocks.some(bl =>
      bl.date === date && bl.room === room && startTime < bl.endTime && endTime > bl.startTime
    );
  },

  async createBooking(data) {
    if (this._hasConflict(data.date, data.room, data.startTime, data.endTime)) {
      throw new Error('해당 시간에 이미 예약이 있거나 사용이 차단된 룸입니다.');
    }
    const booking = { id: 'demo_' + Date.now(), ...data, createdAt: new Date().toISOString() };
    this._bookings.push(booking);
    this._save();
    return { success: true, booking: this._public(booking) };
  },

  async updateBooking(id, data, password) {
    const idx = this._bookings.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('예약을 찾을 수 없습니다.');
    if (this._bookings[idx].password !== password) throw new Error('비밀번호가 일치하지 않습니다.');
    if (this._hasConflict(data.date, data.room, data.startTime, data.endTime, id)) {
      throw new Error('해당 시간에 이미 예약이 있거나 사용이 차단된 룸입니다.');
    }
    Object.assign(this._bookings[idx], data);
    this._save();
    return { success: true };
  },

  async deleteBooking(id, password) {
    const idx = this._bookings.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('예약을 찾을 수 없습니다.');
    if (this._bookings[idx].password !== password) throw new Error('비밀번호가 일치하지 않습니다.');
    this._bookings.splice(idx, 1);
    this._save();
    return { success: true };
  },

  async getMyBookings(name, password) {
    const trimmed = (name || '').trim();
    const bookings = this._bookings
      .filter(b => b.name === trimmed && b.password === password)
      .map(b => this._public(b))
      .sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1));
    return { bookings };
  },

  // === 관리자 ===
  async adminLogin(password) {
    if (password !== this.ADMIN_PASSWORD) throw new Error('관리자 비밀번호가 올바르지 않습니다.');
    return { success: true, token: this.TOKEN };
  },

  async adminInit(token) {
    this._requireAdmin(token);
    return {
      config: this._config(),
      instructors: [...this._instructors],
      stats: this._computeStats(),
      blocks: [...this._blocks].sort((a, b) => (a.date + a.startTime > b.date + b.startTime ? 1 : -1)),
    };
  },

  async adminGetAllBookings(token, page, search) {
    this._requireAdmin(token);
    let bookings = this._bookings.map(b => this._public(b));
    if (search) {
      const q = search.toLowerCase();
      bookings = bookings.filter(b =>
        b.name?.toLowerCase().includes(q) ||
        b.topic?.toLowerCase().includes(q) ||
        b.room?.toLowerCase().includes(q) ||
        b.instructor?.toLowerCase().includes(q) ||
        b.course?.toLowerCase().includes(q)
      );
    }
    bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const pageSize = 20;
    const total = bookings.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    return { bookings: bookings.slice(start, start + pageSize), total, totalPages, currentPage: page };
  },

  async adminDeleteBooking(id, token) {
    this._requireAdmin(token);
    const idx = this._bookings.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('예약을 찾을 수 없습니다.');
    this._bookings.splice(idx, 1);
    this._save();
    return { success: true };
  },

  async adminExport(token) {
    this._requireAdmin(token);
    const bookings = this._bookings
      .map(b => ({ ...this._public(b), email: b.email || '' }))
      .sort((a, b) => (a.date + a.startTime > b.date + b.startTime ? 1 : -1));
    return { bookings };
  },

  _computeStats() {
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();

    const stats = {
      total: 0, upcoming: 0, todayCount: 0, totalHours: 0,
      byInstructor: {}, byRoom: {}, byWeekday: [0, 0, 0, 0, 0, 0, 0], byHour: {},
    };
    let totalMinutes = 0;

    this._bookings.forEach(b => {
      stats.total++;
      if (b.date >= today) stats.upcoming++;
      if (b.date === today) stats.todayCount++;
      stats.byInstructor[b.instructor] = (stats.byInstructor[b.instructor] || 0) + 1;
      stats.byRoom[b.room] = (stats.byRoom[b.room] || 0) + 1;
      const parts = b.date.split('-').map(Number);
      stats.byWeekday[new Date(parts[0], parts[1] - 1, parts[2]).getDay()]++;
      const hour = parseInt(b.startTime, 10);
      if (!isNaN(hour)) stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
      const toMin = t => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
      totalMinutes += Math.max(0, toMin(b.endTime) - toMin(b.startTime));
    });

    stats.totalHours = Math.round(totalMinutes / 60);
    return stats;
  },

  // === 강사 관리 ===
  async adminAddInstructor(name, token) {
    this._requireAdmin(token);
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('강사명을 입력해주세요.');
    if (this._instructors.includes(trimmed)) throw new Error('이미 존재하는 강사명입니다.');
    this._instructors.push(trimmed);
    this._save();
    return { success: true };
  },

  async adminUpdateInstructor(oldName, newName, token) {
    this._requireAdmin(token);
    const trimmed = (newName || '').trim();
    const idx = this._instructors.indexOf(oldName);
    if (idx === -1) throw new Error('강사를 찾을 수 없습니다.');
    if (oldName !== trimmed && this._instructors.includes(trimmed)) throw new Error('이미 존재하는 강사명입니다.');
    this._instructors[idx] = trimmed;
    this._bookings.forEach(b => { if (b.instructor === oldName) b.instructor = trimmed; });
    this._save();
    return { success: true };
  },

  async adminDeleteInstructor(name, token, force) {
    this._requireAdmin(token);
    const idx = this._instructors.indexOf(name);
    if (idx === -1) throw new Error('강사를 찾을 수 없습니다.');

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const futureCount = this._bookings.filter(b => b.instructor === name && b.date >= todayStr).length;
    if (futureCount > 0 && !force) return { needsConfirm: true, futureCount };

    this._instructors.splice(idx, 1);
    this._save();
    return { success: true, futureCount };
  },

  // === 룸 차단 ===
  async adminAddBlock(block, token) {
    this._requireAdmin(token);
    if (!block.room || !block.date) throw new Error('날짜와 룸을 선택해주세요.');
    if (block.startTime >= block.endTime) throw new Error('종료 시간은 시작 시간보다 늦어야 합니다.');
    this._blocks.push({ id: 'demoblk_' + Date.now(), ...block });
    this._save();
    return { success: true, blocks: [...this._blocks] };
  },

  async adminDeleteBlock(id, token) {
    this._requireAdmin(token);
    const idx = this._blocks.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('차단 항목을 찾을 수 없습니다.');
    this._blocks.splice(idx, 1);
    this._save();
    return { success: true, blocks: [...this._blocks] };
  },
};
