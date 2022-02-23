import { isIntegerKey } from '@mini-vue3/shared';
import { isArray } from '@mini-vue3/shared';
import { TriggerOpTypes } from './operators';



let activeEffect
let effectStack = [] //防止嵌套effect 导致当前的activeEffect错乱 用栈数据结构的形式解决，在effect函数执行之前就把自己压入栈中执行完后弹出即可
let uid = 0
// effect(() => { //effect1
//   stat.a  // effectStack = [effect1]
//   effect(() => {  //effect2
//     stat.b // effectStack = [effect1,effect2]
//   })
//   stat.c // effectStack = [effect1]
// })



// /**
//  *
//  * @param fn 当前的副作用函数
//  * @param options 副作用函数的一下选项
//  * @returns
//  */
// export function effect(fn, options: any = {}) {

//   const effect = createReactiveEffect(fn, options)

//   //非懒加载就立即执行
//   if (!options.lazy) {
//     effect()
//   }
//   return effect
// }

// export function createReactiveEffect(fn, options) {

//   const effect = function effect() {

//     if (!effectStack.includes(activeEffect)) {
//       try {
//         effectStack.push(effect)
//         activeEffect = effect
//         fn()
//       }
//       finally {
//         effectStack.pop()
//         activeEffect = effectStack[effectStack.length - 1]
//       }
//     }
//   }
//   effect.raw = fn //保存effect对应的原函数
//   effect.id = uid++ //当前effect的唯一标识
//   effect._isEffect = true //用于标识当前函数式响应式的effect
//   effect.options = options //在effect上保存用户的属性


//   return effect
// }

/**
 * 类的方式创建的effect
 * @param fn 
 * @param options 
 * @returns 
 */
export function effect(fn, options: any = {}) {
  const _effect = new ReactiveEffect(fn)

  //非懒加载就立即执行
  if (!options.lazy) {
    _effect.run()
  }
  let runner = _effect.run.bind(_effect)
  runner.effect = _effect
  return runner
}

/**
 * 
 * @param effect 需要清除的effect实例
 */
function cleanupEffect(effect) {
  const { deps } = effect
  //不能直接使用deps = [] 这样只是清除了effect上deps属性,没有真正取消收集依赖时的dep关联

  //下面的代码是track方法中的将依赖添加到dep集合中，再把dep push到activeEffect.deps属性上，
  //所以如果要删除依赖关系就必须分别循环dep进行删除（因为Set是引用类型的）,
  //直接activeEffect.deps = [] 是根本无法删除依赖关系的
  // let dep = dpsMap.get(key) （Set集合）
  // dep.add(activeEffect) 
  // activeEffect.deps.push(dep)
  for (let dep of deps) {
    dep.delete(effect) //挨个清除与当前的实例绑定的dep
  }
  deps.length = 0
}

export class ReactiveEffect {
  active = true //是否是响应式的effect
  deps = [] // 让effect记录那些属性依赖了，同时要记录当前属性依赖了哪个effect
  constructor(public fn, public scheduler = null) {
  }

  run() {
    if (!this.active) {
      return this.fn()
    }

    if (!effectStack.includes(this)) {
      try {
        effectStack.push(activeEffect = this)
        cleanupEffect(this)
        return this.fn()
      } finally {
        effectStack.pop()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  }

  //停止当前的effect
  //让effect和dep取消关联，dep上面存储的移除掉即可
  stop() {
    if (this.active) {
      cleanupEffect(this)
      this.active = false
    }
  }
}

export const isTracking = () => activeEffect !== undefined

const targetMap = new WeakMap() //使用weakMap保存响应式对象所依赖的依赖集 const state = reactive({age: 1})
/**
 * 依赖effect收集
 * @param target 
 * @param trackOpType 
 * @param key 
 * @returns 
 */
export function track(target, trackOpType, key) {
  console.log('当前访问属性', key)
  //每次访问都收集吗？ activeEffect（当前的effect）为空时不收集
  //例子：
  // const test = reactive({name: 'xxx'})
  // test.name //此时访问name activeEffect为undefined isTracking() = false
  // effect(() => {test.name}) //在effect函数中访问的name,activeEffect有值 isTracking() = true
  if (!isTracking()) {
    return;
  }

  let depsMap = targetMap.get(target) // 获取当前target对象的依赖集
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map)) // 用Map的原因是当前target的属性需要一一对应依赖
  }

  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set))
    // 用Set的原因： 不使用Array的原因是因为一个effect函数中可能出现多个相同属性使用set去重
    // effect(() => {
    //   state.age + state.age
    // })

    //有可能一个响应式对象中的属性在多个effect函数中引用，使用set是不会去重的，因为是两个不同的引用地址
    // effect(() => {
    //   state.age
    // })
    // effect(() => {
    //   state.age
    // })
    //相当于如下例子
    // let set = new Set
    // let a = () => {console.log('xx')}
    // let b = () => {console.log('xx')}
    //set.add(a) set.add(a)  =》 set = {() => {console.log('xx'),() => {console.log('xx')}
  }
  //收集
  trackEffects(dep)
  console.log(`开启收集依赖-收集当前属性:`, key, '\n effect:', activeEffect)

  console.log('deps', key, activeEffect.deps)
  console.log('targetMap', targetMap)
}


export function trackEffects(dep) {
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    //deps主要用于删除当前effect对应的dep
    activeEffect.deps.push(dep)
  }
}


/**
 * 触发effect更新 (数组更新、对象更新，...)
 * @param target 
 * @param type 触发的类型（新增ADD，更新SET）
 * @param key 当前的触发的key
 * @param newValue 新的值
 * @param oldValue 旧的值
 */
export function trigger(target, type, key?, newValue?, oldValue?) {

  const depsMap = targetMap.get(target)
  // 如果当前的target没有依赖就直接返回
  if (!depsMap) return
  /**
   * //使用set方便对effects去重、最后一起执行
   * //例如
   * const state = reactive({a:1,b:2})
   * effect(() =>{
   *  state.a + state.b
   * })
   * 
   * 上面的effect中target=state收集了两个依赖分别是a=>() =>{state.a + state.b} b=> () =>{state.a + state.b} 两个属性的依赖是相同的所以需要去重
   */
  const effects = new Set()

  //添加需要执行的effect
  const add = (effectsToAdd) => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        effects.add(effect)
      });
    }
  }

  //看看是不是修改的数组的长度，修改数组的长度影响比较大
  if (key === 'length' && isArray(target)) {
    //这里的逻辑是当前的key是操作数组的长度时的逻辑，需要将当前target数组的所有和长度相关的依赖都添加到effect = new Set集合中执行
    /**
     * 此时的depsMap就是数组中每个索引或者是数组的属性所对应的effects依赖的映射
     */
    depsMap.forEach((dep, key) => {
      /**
       * depsMap的key就是target数组的索引或者是属性length
       * 遍历depsMap找出depsMap的key === 'length'(和当前数组长度有关的dep都加到effect = new Set中)
       * 或者是depsMap的key >= newValue(此时的newValue是修改的数组长度,如果key>=newValue，需要更新将dep加到effect = new Set中 ) 
       *      const state = reactive({ name: 'xx', arr: [1, 2, 3, 4] })
              effect(() => {
                //state.arr内部会直接访问.length在收集依赖的时候会以'length'为key存入depsMap
                state.arr
                state.arr.length
                console.log(state.arr[3])
              })


              setTimeout(() => {
                state.arr.length = 3 // 修改之后[1,2,3] state.arr[3] = undefined
              }, 2000)
       * 
       */
      if (key === 'length' || String(key) >= newValue) {
        add(dep)
      }
    });
  }

  //修改
  if (!(key === undefined)) {
    add(depsMap.get(key))
  }

  //如果是修改数组中的某一个索引
  switch (type) {
    case TriggerOpTypes.ADD:
      //如果数组新增了索引直接找长度的dep
      if (isArray(target) && isIntegerKey(key)) {
        add(depsMap.get('length'))
      }
  }

  const effectsFn = new Set(effects)
  triggerEffects(effectsFn)
}

export function triggerEffects(dep) {
  dep.forEach((effect: any) => effect !== activeEffect && (effect.scheduler ? effect.scheduler() : effect.run()))
}
